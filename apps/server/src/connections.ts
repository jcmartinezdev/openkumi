// Connections are MCP servers. The catalog in ~/.openbot/mcp.json is shared; each bot's own
// mcp.json lists the ones switched on for it. Every bot gets its own connection and, for servers
// that need an account, its own sign-in, so two bots can use two different accounts.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  auth,
  type CallToolResult,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import type { Connection, ConnectionStatus } from '@openbot/shared'
import { HOME, PORT, botDir, emit, privateDir, workspaceDir } from './config.ts'
import type { Tool } from './tools.ts'

/** One server as written in mcp.json, in the same shape Claude Code and other MCP clients use. */
interface Entry {
  url?: string
  type?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** For a service that does not let an app register itself: the client the owner created with it. */
  oauth?: { clientId: string; clientSecret: string; scope?: string }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
const CATALOG = path.join(HOME, 'mcp.json')

// ---- the catalog

function readCatalog(): Record<string, Entry> {
  try {
    const servers = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).mcpServers
    return servers && typeof servers === 'object' ? servers : {}
  } catch {
    return {}
  }
}

function writeCatalog(servers: Record<string, Entry>) {
  // Headers and environment values can be secrets, so the file is owner-only.
  fs.writeFileSync(CATALOG, JSON.stringify({ mcpServers: servers }, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(CATALOG, 0o600)
  emit({ type: 'connections', connections: listConnections() })
}

const isValid = (name: string, entry: Entry | undefined): entry is Entry =>
  NAME.test(name) && !!entry && (typeof entry.url === 'string' || typeof entry.command === 'string')

export function listConnections(): Connection[] {
  return Object.entries(readCatalog())
    .filter(([name, entry]) => isValid(name, entry))
    .map(([name, entry]) =>
      entry.command
        ? { name, kind: 'command' as const, target: [entry.command, ...(entry.args ?? [])].join(' ') }
        : { name, kind: 'url' as const, target: entry.url! },
    )
}

/** Splits a command line into words, keeping quoted parts together. */
function words(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((m) => m[1]?.replace(/\\(.)/g, '$1') ?? m[2] ?? m[3])
}

/** Adds a connection, or replaces the one of that name. For connections that plugins bring. */
export function putConnection(name: string, entry: Entry) {
  const servers = readCatalog()
  if (JSON.stringify(servers[name]) === JSON.stringify(entry)) return
  servers[name] = entry
  writeCatalog(servers)
}

export function addConnection(input: Record<string, unknown>) {
  const name = String(input.name ?? '').trim()
  if (!NAME.test(name)) throw new Error('Give the connection a short name using letters, numbers, - or _.')
  const servers = readCatalog()
  if (servers[name]) throw new Error(`There is already a connection named "${name}".`)
  if (typeof input.command === 'string' && input.command.trim()) {
    const [command, ...args] = words(input.command.trim())
    servers[name] = { command, args }
  } else {
    const url = String(input.url ?? '').trim()
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error('The address must start with http:// or https://')
    const token = String(input.token ?? '').trim()
    servers[name] = token ? { url, headers: { Authorization: /^\S+\s/.test(token) ? token : `Bearer ${token}` } } : { url }
  }
  writeCatalog(servers)
}

/** Removes a connection from the catalog and from every bot that had it switched on. */
export async function removeConnection(name: string): Promise<string[]> {
  const servers = readCatalog()
  if (!Object.hasOwn(servers, name)) throw new Error('No such connection')
  const affected: string[] = []
  for (const botId of fs.readdirSync(path.join(HOME, 'bots'))) {
    if (!enabledNames(botId).includes(name)) continue
    await setConnection(botId, name, false)
    affected.push(botId)
  }
  delete servers[name]
  writeCatalog(servers)
  return affected
}

// ---- per bot

const botFile = (botId: string) => path.join(botDir(botId), 'mcp.json')

function enabledNames(botId: string): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(botFile(botId), 'utf8')).enabled
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string') : []
  } catch {
    return []
  }
}

/** The connections switched on for a bot that still exist in the catalog. */
export function enabledConnections(botId: string): string[] {
  const names = enabledNames(botId)
  if (!names.length) return []
  const servers = readCatalog()
  return names.filter((name) => isValid(name, servers[name])).sort()
}

export async function setConnection(botId: string, name: string, on: boolean) {
  if (on && !isValid(name, readCatalog()[name])) throw new Error(`There is no connection named "${name}".`)
  const names = new Set(enabledNames(botId))
  if (on) names.add(name)
  else names.delete(name)
  fs.writeFileSync(botFile(botId), JSON.stringify({ enabled: [...names].sort() }, null, 2) + '\n')
  if (on) void connect(botId, name).catch(() => {})
  else {
    await drop(botId, name)
    setStatus(botId, name, null)
  }
}

// ---- sign-in

/** Sign-ins waiting for the browser to come back, by the `state` value sent with them. */
const pending = new Map<string, { botId: string; name: string; at: number }>()

interface Saved {
  client?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  verifier?: string
  discovery?: OAuthDiscoveryState
}

/** One bot's account with one server, kept in the bot's private folder where the bot cannot read it. */
class Credentials implements OAuthClientProvider {
  private file: string
  private botId: string
  private name: string
  /** Where the user has to go to sign in, once the server has asked for that. */
  authUrl: URL | null = null

  constructor(botId: string, name: string) {
    this.botId = botId
    this.name = name
    this.file = path.join(privateDir(botId), 'mcp', `${name}.json`)
  }

  private load(): Saved {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return {}
    }
  }

  private save(patch: Partial<Saved>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify({ ...this.load(), ...patch }, null, 2), { mode: 0o600 })
    fs.chmodSync(this.file, 0o600)
  }

  clear() {
    fs.rmSync(this.file, { force: true })
  }

  hasTokens() {
    return !!this.load().tokens
  }

  // The sign-in comes back to this server, so it has to finish in a browser on this computer.
  get redirectUrl() {
    return `http://localhost:${PORT}/api/mcp/callback`
  }

  /** The client the owner created with the service, when it is one that needs that. */
  private get own() {
    return readCatalog()[this.name]?.oauth
  }

  get clientMetadata() {
    return {
      client_name: 'Open Bot',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.own ? 'client_secret_post' : 'none',
      ...(this.own?.scope ? { scope: this.own.scope } : {}),
    }
  }

  state() {
    const now = Date.now()
    for (const [key, p] of pending) if (now - p.at > 15 * 60_000) pending.delete(key)
    const state = crypto.randomBytes(18).toString('base64url')
    pending.set(state, { botId: this.botId, name: this.name, at: now })
    return state
  }

  // With a client of the owner's there is nothing to register: that client is the one used.
  clientInformation = () => (this.own ? { client_id: this.own.clientId, client_secret: this.own.clientSecret } : this.load().client)
  saveClientInformation = (client: StoredOAuthClientInformation) => this.save({ client })
  tokens = () => this.load().tokens
  saveTokens = (tokens: StoredOAuthTokens) => this.save({ tokens })
  saveCodeVerifier = (verifier: string) => this.save({ verifier })
  discoveryState = () => this.load().discovery
  saveDiscoveryState = (discovery: OAuthDiscoveryState) => this.save({ discovery })

  codeVerifier() {
    const { verifier } = this.load()
    if (!verifier) throw new Error('No sign-in is in progress')
    return verifier
  }

  redirectToAuthorization(url: URL) {
    this.authUrl = url
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') this.clear()
    else this.save({ [scope]: undefined })
  }
}

function urlEntry(name: string): Entry & { url: string } {
  const entry = readCatalog()[name]
  if (!isValid(name, entry) || !entry.url) throw new Error('That connection does not use a sign-in.')
  return entry as Entry & { url: string }
}

/** Starts a sign-in and returns the page to open, or null when the saved account still works. */
export async function login(botId: string, name: string): Promise<{ url: string | null }> {
  const entry = urlEntry(name)
  const creds = new Credentials(botId, name)
  // With a client of the owner's, only what the plugin asks for is requested, not everything the service offers.
  const result = await auth(creds, { serverUrl: entry.url, scope: entry.oauth?.scope })
  if (result === 'AUTHORIZED') {
    await reconnect(botId, name)
    return { url: null }
  }
  // The page is opened in the owner's browser, so it must be a web address and nothing else.
  if (!creds.authUrl || !/^https?:$/.test(creds.authUrl.protocol)) throw new Error('The server did not offer a sign-in page.')
  return { url: String(creds.authUrl) }
}

/** Finishes a sign-in with what the server sent back to the callback address. */
export async function finishLogin(params: URLSearchParams): Promise<{ botId: string; name: string }> {
  const state = params.get('state') ?? ''
  const waiting = pending.get(state)
  if (!waiting) throw new Error('This sign-in has expired. Start it again from the bot’s Connections.')
  pending.delete(state)
  const code = params.get('code')
  if (!code) throw new Error('The sign-in was not completed.')
  const { botId, name } = waiting
  await auth(new Credentials(botId, name), { serverUrl: urlEntry(name).url, authorizationCode: code, iss: params.get('iss') ?? undefined })
  await reconnect(botId, name)
  return waiting
}

export async function logout(botId: string, name: string) {
  await drop(botId, name)
  new Credentials(botId, name).clear()
  await reconnect(botId, name)
}

// ---- live connections

interface Live {
  client: Client
  tools: Tool[]
}

const key = (botId: string, name: string) => `${botId}\n${name}`
const live = new Map<string, Promise<Live>>()
const statuses = new Map<string, ConnectionStatus>()
/** When a connection last failed, so a broken server is not retried on every step of a turn. */
const failed = new Map<string, number>()

function setStatus(botId: string, name: string, status: ConnectionStatus | null) {
  if (status) statuses.set(key(botId, name), status)
  else statuses.delete(key(botId, name))
  emit({ type: 'connection.status', botId, name, status })
}

export function connectionStatuses(): Record<string, Record<string, ConnectionStatus>> {
  const out: Record<string, Record<string, ConnectionStatus>> = {}
  for (const [k, status] of statuses) {
    const [botId, name] = k.split('\n')
    ;(out[botId] ??= {})[name] = status
  }
  return out
}

/** A tool result as text for the model. Pictures and other attachments are described, not included. */
function resultText(result: CallToolResult): string {
  const parts = (result.content ?? []).map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'resource') return 'text' in block.resource ? String(block.resource.text) : `[file: ${block.resource.uri}]`
    if (block.type === 'resource_link') return `[link: ${block.uri}]`
    return `[${block.type} attachment]`
  })
  let text = parts.join('\n').trim()
  if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent, null, 1)
  return result.isError ? `Error: ${text || 'the tool failed'}` : text || '(no output)'
}

async function open(botId: string, name: string): Promise<Live> {
  const entry = readCatalog()[name]
  if (!isValid(name, entry)) throw new Error(`There is no connection named "${name}".`)
  const k = key(botId, name)
  const result: Live = { client: null as unknown as Client, tools: [] }

  const toTools = (list: { name: string; description?: string; inputSchema?: unknown }[]): Tool[] =>
    list.map((t) => ({
      // Model APIs accept only these characters in a tool name, and at most 64 of them.
      name: `mcp__${name}__${t.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64),
      description: `[${name}] ${t.description ?? t.name}`.slice(0, 1200),
      parameters: { type: 'object', properties: {}, ...(t.inputSchema as object) },
      run: async (args, ctx) => {
        const current = await connect(botId, name)
        return resultText(await current.client.callTool({ name: t.name, arguments: args }, { signal: ctx.signal, timeout: 120_000 }))
      },
    }))

  const make = () =>
    new Client(
      { name: 'open-bot', version: '0.1.0' },
      {
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (error || !tools) return
              result.tools = toTools(tools)
              setStatus(botId, name, { state: 'connected', tools: tools.length, signedIn: new Credentials(botId, name).hasTokens() })
            },
          },
        },
      },
    )

  let client = make()
  if (entry.command) {
    // A local program: it runs as the user, with the bot's workspace as its working folder.
    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args ?? [],
      env: { ...getDefaultEnvironment(), ...entry.env },
      cwd: workspaceDir(botId),
      stderr: 'ignore',
    })
    await client.connect(transport, { timeout: 30_000 })
  } else {
    const url = new URL(entry.url!)
    const options = { authProvider: new Credentials(botId, name), requestInit: { headers: entry.headers } }
    try {
      if (entry.type === 'sse') throw new Error('sse')
      await client.connect(new StreamableHTTPClientTransport(url, options), { timeout: 30_000 })
    } catch (first) {
      if (first instanceof UnauthorizedError) throw first
      // Older servers speak the earlier SSE transport at the same address.
      await client.close().catch(() => {})
      client = make()
      await client.connect(new SSEClientTransport(url, options), { timeout: 30_000 }).catch((second) => {
        throw second instanceof UnauthorizedError || entry.type === 'sse' ? second : first
      })
    }
  }
  result.client = client
  // If the server goes away, forget the connection so the next turn makes a new one.
  const mine = live.get(k)
  client.onclose = () => {
    if (live.get(k) === mine) live.delete(k)
  }
  result.tools = toTools((await client.listTools()).tools)
  return result
}

function connect(botId: string, name: string): Promise<Live> {
  const k = key(botId, name)
  const existing = live.get(k)
  if (existing) return existing
  setStatus(botId, name, { state: 'connecting', tools: 0 })
  const attempt = open(botId, name).then(
    (connection) => {
      failed.delete(k)
      setStatus(botId, name, { state: 'connected', tools: connection.tools.length, signedIn: new Credentials(botId, name).hasTokens() })
      return connection
    },
    (e) => {
      if (live.get(k) === attempt) live.delete(k)
      failed.set(k, Date.now())
      const needsLogin = e instanceof UnauthorizedError || /unauthorized|\b401\b/i.test(String(e?.message))
      setStatus(botId, name, needsLogin ? { state: 'needs-login', tools: 0 } : { state: 'error', tools: 0, error: String(e?.message ?? e).split('\n')[0].slice(0, 300) })
      throw e
    },
  )
  live.set(k, attempt)
  return attempt
}

async function drop(botId: string, name: string) {
  const k = key(botId, name)
  const connection = live.get(k)
  live.delete(k)
  failed.delete(k)
  await connection?.then((c) => c.client.close()).catch(() => {})
}

async function reconnect(botId: string, name: string) {
  await drop(botId, name)
  if (enabledConnections(botId).includes(name)) await connect(botId, name).catch(() => {})
}

/** Connects (again) everything switched on for a bot; the UI asks for this when its tab opens. */
export function checkConnections(botId: string) {
  for (const name of enabledConnections(botId)) {
    const status = statuses.get(key(botId, name))
    if (status?.state === 'connected' || status?.state === 'connecting') continue
    failed.delete(key(botId, name))
    void connect(botId, name).catch(() => {})
  }
}

/** The tools of a bot's connections for one model request, plus a line for each that is unavailable. */
export async function connectionTools(botId: string): Promise<{ tools: Tool[]; notes: string[] }> {
  const tools: Tool[] = []
  const notes: string[] = []
  await Promise.all(
    enabledConnections(botId).map(async (name) => {
      const k = key(botId, name)
      const recentFailure = Date.now() - (failed.get(k) ?? 0) < 60_000
      try {
        if (recentFailure && !live.has(k)) throw new Error('unavailable')
        tools.push(...(await connect(botId, name)).tools)
      } catch {
        const status = statuses.get(k)
        notes.push(
          status?.state === 'needs-login'
            ? `- ${name}: the user has to sign in first (bot settings, Connections).`
            : `- ${name}: not reachable right now${status?.error ? ` (${status.error})` : ''}.`,
        )
      }
    }),
  )
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return { tools, notes: notes.sort() }
}

export async function closeBotConnections(botId: string) {
  const names = [...live.keys()].filter((k) => k.startsWith(`${botId}\n`)).map((k) => k.split('\n')[1])
  await Promise.all(names.map((name) => drop(botId, name)))
  for (const k of [...statuses.keys()]) if (k.startsWith(`${botId}\n`)) statuses.delete(k)
}

export async function closeAllConnections() {
  const all = [...live.values()]
  live.clear()
  await Promise.all(all.map((c) => c.then((l) => l.client.close()).catch(() => {})))
}
