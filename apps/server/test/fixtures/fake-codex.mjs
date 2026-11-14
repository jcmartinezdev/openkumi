#!/usr/bin/env node
// Stands in for the `codex` program in tests: its app server, speaking the same JSON-RPC over input
// and output, with scripted replies. "!tool <name> <json>" calls a tool at the address it was
// given, "!system" and "!args" report what it was started with, "!slow" takes a while and can be
// told more as it works (turn/steer), "!busy" takes a while and refuses to be told more, anything
// else is echoed with the turn number and the kinds of the pictures it was shown.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const args = process.argv.slice(2)
const print = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

if (args[0] === '--version') {
  console.log('codex-cli 0.9.0')
  process.exit(0)
}

if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT')
  process.exit(0)
}
if (args[0] !== 'app-server') process.exit(2)

// `-c key=value` settings, with values written as TOML (here always a JSON-compatible value).
const config = {}
args.forEach((a, i) => {
  if (a !== '-c') return
  const [, key, value] = args[i + 1].match(/^([^=]+)=([\s\S]*)$/)
  try {
    config[key] = JSON.parse(value)
  } catch {
    config[key] = value
  }
})

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const file = (session) => path.join(os.tmpdir(), `openkumi-fake-codex-${session}.json`)
/** The conversation that is open, the turn that is running in it, and what the turn was told since it began. */
let thread = null
let opened = {}
let active = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Writes a reply the way the real program does: a word at a time, then whole. */
function say(turnId, text) {
  const itemId = `msg_${crypto.randomUUID()}`
  for (const word of text.split(/(?<=\s)/).slice(0, 3)) print({ method: 'item/agentMessage/delta', params: { threadId: thread, turnId, itemId, delta: word } })
  print({ method: 'item/completed', params: { threadId: thread, turnId, item: { type: 'agentMessage', id: itemId, text, phase: 'final_answer' } } })
}

function finish(turn, status) {
  if (active !== turn) return
  active = null
  print({ method: 'turn/completed', params: { threadId: thread, turn: { id: turn.id, status, error: null } } })
}

async function run(turn, input) {
  const prompt = input.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  const shown = input.filter((part) => part.type === 'localImage').map((part) => (fs.existsSync(part.path) ? TYPES[path.extname(part.path)] : 'missing'))
  const count = JSON.parse(fs.readFileSync(file(thread), 'utf8')).turn + 1
  fs.writeFileSync(file(thread), JSON.stringify({ turn: count }))
  print({ method: 'turn/started', params: { threadId: thread, turn: { id: turn.id, status: 'inProgress' } } })

  let reply
  const call = prompt.match(/^!tool (\w+)\s*([\s\S]*)$/)
  if (call) {
    const res = await fetch(config['mcp_servers.openkumi.url'], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: call[1], arguments: JSON.parse(call[2] || '{}') } }),
    })
    reply = `Tool result: ${(await res.json()).result.content[0].text.slice(0, 600)}`
  } else if (prompt === '!system') {
    reply = config.developer_instructions
  } else if (prompt === '!args') {
    reply = JSON.stringify({ config: { ...config, developer_instructions: undefined, 'mcp_servers.openkumi.url': undefined }, disabled: args.filter((_, i) => args[i - 1] === '--disable'), flags: args.filter((a) => a.startsWith('--')), opened })
  } else {
    // At work for a while, unless it is told something more, which it then answers too.
    if (/^!(slow|busy)/.test(prompt)) for (let waited = 0; waited < 8000 && active === turn && !turn.told.length; waited += 50) await sleep(50)
    if (active !== turn) return
    reply = `Echo (turn ${count}): ${prompt}${shown.length ? ` [shown: ${shown.join(', ')}]` : ''}${turn.told.length ? ` [told as it worked: ${turn.told.join(' / ')}]` : ''}`
  }
  if (active !== turn) return
  say(turn.id, reply)
  finish(turn, 'completed')
}

const answer = (id, result) => print({ id, result })
const refuse = (id, message) => print({ id, error: { code: -32600, message } })

for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line)
  if (method === 'initialize') answer(id, { userAgent: 'fake-codex', platformOs: 'test' })
  else if (method === 'thread/start' || method === 'thread/resume') {
    const session = method === 'thread/resume' ? params.threadId : crypto.randomUUID()
    if (method === 'thread/resume' && !fs.existsSync(file(session))) {
      refuse(id, `no rollout found for thread id ${session}`)
      continue
    }
    if (method === 'thread/start') fs.writeFileSync(file(session), JSON.stringify({ turn: 0 }))
    thread = session
    opened = { sandbox: params.sandbox, approvalPolicy: params.approvalPolicy, model: params.model ?? null, cwd: params.cwd }
    answer(id, { thread: { id: session }, model: params.model ?? 'fake-model' })
    if (method === 'thread/start') print({ method: 'thread/started', params: { thread: { id: session } } })
  } else if (method === 'turn/start') {
    active = { id: crypto.randomUUID(), told: [], steerable: !params.input.some((part) => part.type === 'text' && part.text.startsWith('!busy')) }
    answer(id, { turn: { id: active.id, status: 'inProgress' } })
    void run(active, params.input)
  } else if (method === 'turn/steer') {
    if (!active || active.id !== params.expectedTurnId) refuse(id, 'no active turn to steer')
    else if (!active.steerable) refuse(id, 'the active turn cannot be steered')
    else {
      active.told.push(params.input.filter((part) => part.type === 'text').map((part) => part.text).join('\n'))
      answer(id, { turnId: active.id })
    }
  } else if (method === 'turn/interrupt') {
    answer(id, {})
    if (active) finish(active, 'interrupted')
  } else if (id !== undefined) refuse(id, `unknown method ${method}`)
}
