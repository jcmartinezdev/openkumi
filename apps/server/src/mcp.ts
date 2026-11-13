// The services superpowers bring, such as Notion, reached over MCP. Every bot that has one gets a
// connection of its own and, for services that need an account, a sign-in of its own, so two bots
// can use two different accounts. Signing a bot in to a service is what activates the superpower.
// It happens in the owner's own browser (the desktop app catches the way back, at APP_RETURN) or
// in the bot's browser, which works from any device (see browser.ts). A service that does not let
// OpenKumi register itself (Google's) signs in with the client the owner registered for it. That kind
// of client comes back only to a web address, so the owner's own browser comes back by way of
// RETURN_PAGE, which passes it on to the app.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  Client,
  InsufficientScopeError,
  type OAuthClientInformationContext,
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
import type { SuperpowerStatus } from '@openkumi/shared'
import { SIGN_IN_RETURN, browserFor } from './browser.ts'
import { emit, privateDir, workspaceDir } from './config.ts'
import { type Service, enabledSuperpowers, missingRegistration, registeredClient, serviceOf, signedIn } from './superpowers.ts'
import type { Tool } from './tools.ts'

/** The superpowers switched on for a bot that bring a service. */
const services = (botId: string) => enabledSuperpowers(botId).filter((id) => serviceOf(id))

function needService(id: string): Service {
  const service = serviceOf(id)
  if (!service) throw new Error('That superpower has nothing to sign in to.')
  return service
}

// ---- sign-in

/**
 * Where a service sends the owner's own browser back to. The OpenKumi app on that computer is what
 * opens it, and passes it on (apps/desktop/src/main.ts).
 */
const APP_RETURN = 'openkumi://sign-in/callback'
/**
 * OpenKumi's public page that sends a browser on to APP_RETURN (apps/sign-in-page), for the companies
 * that send it back only to a web address. Without one, their sign-ins happen in the bot's browser alone.
 */
export const RETURN_PAGE = process.env.OPENKUMI_RETURN_PAGE ?? ''
/** Which browser a sign-in happens in: the owner's own ('app'), or the bot's ('bot'). */
type Via = 'app' | 'bot'

/** Sign-ins waiting for the browser to come back, by the `state` value sent with them. */
const pending = new Map<string, { botId: string; id: string; via: Via; at: number }>()

interface Saved {
  client?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  verifier?: string
  discovery?: OAuthDiscoveryState
}

/** One bot's account with one service, kept in the bot's private folder where the bot cannot read it. */
class Credentials implements OAuthClientProvider {
  private file: string
  private botId: string
  private id: string
  private via: Via
  /** Where the user has to go to sign in, once the service has asked for that. */
  authUrl: URL | null = null

  constructor(botId: string, id: string, via: Via = 'bot') {
    this.botId = botId
    this.id = id
    this.via = via
    this.file = path.join(privateDir(botId), 'superpowers', `${id}.json`)
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

  // The owner's own browser comes back to the app (by way of the page, for a client the owner
  // registered); the bot's browser catches its address on the way.
  get redirectUrl() {
    if (this.via === 'bot') return SIGN_IN_RETURN
    return registeredClient(this.id) ? RETURN_PAGE : APP_RETURN
  }

  get clientMetadata() {
    return {
      client_name: 'OpenKumi',
      // Both, so a bot can be signed in either way with the one registration.
      redirect_uris: [SIGN_IN_RETURN, APP_RETURN],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  state() {
    const now = Date.now()
    for (const [key, p] of pending) if (now - p.at > 15 * 60_000) pending.delete(key)
    const state = crypto.randomBytes(18).toString('base64url')
    pending.set(state, { botId: this.botId, id: this.id, via: this.via, at: now })
    return state
  }

  // With a client the owner registered there is nothing to register: that client is the one used.
  clientInformation = (ctx?: OAuthClientInformationContext): StoredOAuthClientInformation | undefined => {
    const own = registeredClient(this.id)
    return own ? { client_id: own.clientId, client_secret: own.clientSecret, issuer: ctx?.issuer } : this.load().client
  }
  saveClientInformation = (client: StoredOAuthClientInformation) => {
    if (!registeredClient(this.id)) this.save({ client })
  }
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
    // Whatever else the company's sign-in page has to be asked for, such as a sign-in that lasts.
    for (const [name, value] of Object.entries(registeredClient(this.id)?.authorize ?? {})) url.searchParams.set(name, value)
    this.authUrl = url
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') this.clear()
    else this.save({ [scope]: undefined })
  }
}

function webService(id: string): Service & { url: string } {
  const service = needService(id)
  if (!service.url) throw new Error('That superpower has nothing to sign in to.')
  return service as Service & { url: string }
}

/** What a sign-in to a superpower's service is done with: its address, and what the bot asks for there. */
function signInTo(id: string) {
  const service = webService(id)
  return { serverUrl: service.url, scope: service.scopes?.join(' ') }
}

/**
 * Starts signing a bot in to a superpower's service, which activates the superpower once it is
 * done. In the owner's own browser, the page to open there is given back; in the bot's browser, the
 * window it opened in, which the owner then uses from whichever device they are on. `done` when the
 * account the bot has still works.
 */
export async function login(botId: string, id: string, headless: boolean, via: Via): Promise<{ url?: string; windowId?: string; done?: true }> {
  const service = webService(id)
  const company = missingRegistration(id)
  if (company) throw new Error(`OpenKumi is not registered with ${company} yet. Register it on ${service.name}’s page, under Superpowers.`)
  if (via === 'app' && service.registration && !RETURN_PAGE) throw new Error(`${service.name} signs in inside the bot’s browser.`)
  // Activating starts afresh: whatever an earlier attempt left behind is of no use.
  if (!enabledSuperpowers(botId).includes(id)) new Credentials(botId, id).clear()
  const creds = new Credentials(botId, id, via)
  const result = await auth(creds, signInTo(id))
  if (result === 'AUTHORIZED') {
    signedIn(botId, id)
    await reconnect(botId, id)
    return { done: true }
  }
  // The page is opened in a browser, so it must be a web address and nothing else.
  if (!creds.authUrl || !/^https?:$/.test(creds.authUrl.protocol)) throw new Error('The service did not offer a sign-in page.')
  if (via === 'app') return { url: String(creds.authUrl) }
  return { windowId: await browserFor(botId).signIn(id, String(creds.authUrl), headless, async (back) => void (await finishLogin(back.searchParams, 'bot', botId))) }
}

/** Finishes a sign-in with what the service sent the browser back with, and activates the superpower. */
async function finishLogin(params: URLSearchParams, via: Via, botId?: string): Promise<{ botId: string; id: string }> {
  const state = params.get('state') ?? ''
  const waiting = pending.get(state)
  // Only a sign-in that was started here, the way it came back, for that bot, and only once.
  if (!waiting || waiting.via !== via || (botId && waiting.botId !== botId)) throw new Error('This sign-in has expired. Start it again from the bot’s Superpowers.')
  pending.delete(state)
  const code = params.get('code')
  if (!code) throw new Error(params.get('error_description') || 'The sign-in was not completed.')
  await auth(new Credentials(waiting.botId, waiting.id, via), { ...signInTo(waiting.id), authorizationCode: code, iss: params.get('iss') ?? undefined })
  signedIn(waiting.botId, waiting.id)
  await reconnect(waiting.botId, waiting.id)
  return { botId: waiting.botId, id: waiting.id }
}

/** The owner's own browser came back to the app with `address`, which the app passed on. */
export function finishAppSignIn(address: string) {
  if (!address.startsWith(`${APP_RETURN}?`)) throw new Error('That is not the way back from a sign-in.')
  return finishLogin(new URL(address).searchParams, 'app')
}

/** The owner gave up on a sign-in. A superpower that was being activated is left as it was, with nothing kept. */
export function cancelLogin(botId: string, id: string) {
  browserFor(botId).endSignIn(id)
  for (const [state, p] of pending) if (p.botId === botId && p.id === id) pending.delete(state)
  if (!enabledSuperpowers(botId).includes(id)) new Credentials(botId, id).clear()
}

// ---- live connections

interface Live {
  client: Client
  tools: Tool[]
}

const key = (botId: string, id: string) => `${botId}\n${id}`
const live = new Map<string, Promise<Live>>()
const statuses = new Map<string, SuperpowerStatus>()
/** When a connection last failed, so a broken service is not retried on every step of a turn. */
const failed = new Map<string, number>()

function setStatus(botId: string, id: string, status: SuperpowerStatus | null) {
  if (status) statuses.set(key(botId, id), status)
  else statuses.delete(key(botId, id))
  emit({ type: 'superpower.status', botId, id, status })
}

export function superpowerStatuses(): Record<string, Record<string, SuperpowerStatus>> {
  const out: Record<string, Record<string, SuperpowerStatus>> = {}
  for (const [k, status] of statuses) {
    const [botId, id] = k.split('\n')
    ;(out[botId] ??= {})[id] = status
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

async function open(botId: string, id: string): Promise<Live> {
  const service = needService(id)
  const k = key(botId, id)
  const result: Live = { client: null as unknown as Client, tools: [] }

  const toTools = (list: { name: string; description?: string; inputSchema?: unknown }[]): Tool[] =>
    list.map((t) => ({
      // Model APIs accept only these characters in a tool name, and at most 64 of them.
      name: `mcp__${id}__${t.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64),
      description: `[${service.name}] ${t.description ?? t.name}`.slice(0, 1200),
      parameters: { type: 'object', properties: {}, ...(t.inputSchema as object) },
      run: async (args, ctx) => {
        const current = await connect(botId, id)
        try {
          return resultText(await current.client.callTool({ name: t.name, arguments: args }, { signal: ctx.signal, timeout: 120_000 }))
        } catch (e) {
          // Some services (Google's) let a bot connect and list its tools without its account, and
          // only ask for the account when a tool is used, so this is where a lapsed sign-in shows.
          if (!(e instanceof UnauthorizedError || e instanceof InsufficientScopeError)) throw e
          await signedOut(botId, id)
          throw new Error(
            e instanceof UnauthorizedError
              ? `you are not signed in to ${service.name} any more. Ask the user to sign you in again, under Superpowers in your settings.`
              : `your sign-in to ${service.name} does not allow this. Ask the user to sign you in again, under Superpowers in your settings, and to allow everything ${service.name} asks about.`,
          )
        }
      },
    }))

  const make = () =>
    new Client(
      { name: 'openkumi', version: '0.1.0' },
      {
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (error || !tools) return
              result.tools = toTools(tools)
              setStatus(botId, id, { state: 'connected', tools: tools.length, signedIn: new Credentials(botId, id).hasTokens() })
            },
          },
        },
      },
    )

  let client = make()
  if (service.command) {
    // A program on this computer: it runs as the user, with the bot's workspace as its working folder.
    const transport = new StdioClientTransport({
      command: service.command,
      args: service.args ?? [],
      env: getDefaultEnvironment(),
      cwd: workspaceDir(botId),
      stderr: 'ignore',
    })
    await client.connect(transport, { timeout: 30_000 })
  } else {
    const url = new URL(service.url!)
    const options = { authProvider: new Credentials(botId, id) }
    try {
      await client.connect(new StreamableHTTPClientTransport(url, options), { timeout: 30_000 })
    } catch (first) {
      if (first instanceof UnauthorizedError) throw first
      // Older servers speak the earlier SSE transport at the same address.
      await client.close().catch(() => {})
      client = make()
      await client.connect(new SSEClientTransport(url, options), { timeout: 30_000 }).catch((second) => {
        throw second instanceof UnauthorizedError ? second : first
      })
    }
  }
  result.client = client
  // If the service goes away, forget the connection so the next turn makes a new one.
  const mine = live.get(k)
  client.onclose = () => {
    if (live.get(k) === mine) live.delete(k)
  }
  result.tools = toTools((await client.listTools()).tools)
  return result
}

function connect(botId: string, id: string): Promise<Live> {
  const k = key(botId, id)
  const existing = live.get(k)
  if (existing) return existing
  setStatus(botId, id, { state: 'connecting', tools: 0 })
  const attempt = open(botId, id).then(
    (connection) => {
      failed.delete(k)
      setStatus(botId, id, { state: 'connected', tools: connection.tools.length, signedIn: new Credentials(botId, id).hasTokens() })
      return connection
    },
    (e) => {
      if (live.get(k) === attempt) live.delete(k)
      failed.set(k, Date.now())
      const needsLogin = e instanceof UnauthorizedError || /unauthorized|\b401\b/i.test(String(e?.message))
      setStatus(botId, id, needsLogin ? { state: 'needs-login', tools: 0 } : { state: 'error', tools: 0, error: String(e?.message ?? e).split('\n')[0].slice(0, 300) })
      throw e
    },
  )
  live.set(k, attempt)
  return attempt
}

async function drop(botId: string, id: string) {
  const k = key(botId, id)
  const connection = live.get(k)
  live.delete(k)
  failed.delete(k)
  await connection?.then((c) => c.client.close()).catch(() => {})
}

/** A bot's account with a service stopped working: the app shows it has to sign in again. */
async function signedOut(botId: string, id: string) {
  await drop(botId, id)
  failed.set(key(botId, id), Date.now())
  setStatus(botId, id, { state: 'needs-login', tools: 0 })
}

async function reconnect(botId: string, id: string) {
  await drop(botId, id)
  if (services(botId).includes(id)) await connect(botId, id).catch(() => {})
}

/** A superpower was just switched on for a bot: connect to its service, so its state shows at once. */
export function wake(botId: string, id: string) {
  if (serviceOf(id)) void connect(botId, id).catch(() => {})
}

/** A superpower was switched off for a bot: the connection ends and the bot's account with the service is forgotten. */
export async function forget(botId: string, id: string) {
  await drop(botId, id)
  new Credentials(botId, id).clear()
  setStatus(botId, id, null)
}

/** Connects (again) every service a bot has; the app asks for this when it shows them. */
export function checkServices(botId: string) {
  for (const id of services(botId)) {
    const status = statuses.get(key(botId, id))
    if (status?.state === 'connected' || status?.state === 'connecting') continue
    failed.delete(key(botId, id))
    void connect(botId, id).catch(() => {})
  }
}

/** The tools of a bot's services for one model request, and why any of them cannot be used right now, by superpower. */
export async function serviceTools(botId: string): Promise<{ tools: Tool[]; problems: Record<string, string> }> {
  const tools: Tool[] = []
  const problems: Record<string, string> = {}
  await Promise.all(
    services(botId).map(async (id) => {
      const k = key(botId, id)
      const recentFailure = Date.now() - (failed.get(k) ?? 0) < 60_000
      try {
        if (recentFailure && !live.has(k)) throw new Error('unavailable')
        tools.push(...(await connect(botId, id)).tools)
      } catch {
        const status = statuses.get(k)
        problems[id] =
          status?.state === 'needs-login'
            ? 'the user has to sign you in first, under Superpowers in your settings'
            : `not reachable right now${status?.error ? ` (${status.error})` : ''}`
      }
    }),
  )
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return { tools, problems }
}

/** Ends a bot's connections, when the bot is deleted. */
export async function closeBot(botId: string) {
  const ids = [...live.keys()].filter((k) => k.startsWith(`${botId}\n`)).map((k) => k.split('\n')[1])
  await Promise.all(ids.map((id) => drop(botId, id)))
  for (const k of [...statuses.keys()]) if (k.startsWith(`${botId}\n`)) statuses.delete(k)
}

export async function closeAll() {
  const all = [...live.values()]
  live.clear()
  await Promise.all(all.map((c) => c.then((l) => l.client.close()).catch(() => {})))
}
