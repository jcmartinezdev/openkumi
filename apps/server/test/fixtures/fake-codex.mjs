#!/usr/bin/env node
// Stands in for the `codex` program in tests: its app server, speaking the same JSON-RPC over input
// and output, with scripted replies. "!tool <name> <json>" calls a tool at the address it was
// given, "!system" and "!args" report what it was started with, "!slow" takes a while and can be
// told more as it works (turn/steer), "!busy" takes a while and refuses to be told more, anything
// else is echoed with the turn number and the kinds of the pictures it was shown.
//
// It also stands in for the voice of a call (thread/realtime/*). The "sound" of a test call is in
// the offer it is started with, a line each: "a=says:<words>" is the caller saying something to
// the voice, which hands it over; "a=chat:<words>" is small talk the voice answers itself;
// "a=refuse:<why>" has the call refused. What it is given to say, it says. Its answer to the
// offer carries what the call was started with, for a test to read. An offer made by a real
// window gets an answer the window accepts instead (from a peer it never reaches), and the call's
// "sound" is then read from OPENKUMI_FAKE_CALL, its lines divided by "|" ("chat:Hello|says:…").
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
/** The instructions the conversation was opened with. */
let instructions = ''
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
  const told = input.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  // Something asked on a call arrives wrapped, with what was said just before it: a test's command is what was asked.
  const prompt = /\nThe user asks, on the call:\n([\s\S]*)\n<\/call_request>$/.exec(told)?.[1] ?? told
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
    reply = instructions
  } else if (prompt === '!args') {
    reply = JSON.stringify({ config: { ...config, 'mcp_servers.openkumi.url': undefined }, disabled: args.filter((_, i) => args[i - 1] === '--disable'), flags: args.filter((a) => a.startsWith('--')), opened })
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

// ---- a call
const VOICES = ['juniper', 'maple', 'cove']
/** The client asked for what is still experimental, which a call is. */
let experimental = false
let onCall = false
const heard = (role, text) => {
  for (const word of text.split(/(?<=\s)/).slice(0, 2)) print({ method: 'thread/realtime/transcript/delta', params: { threadId: thread, role, delta: word } })
  print({ method: 'thread/realtime/transcript/done', params: { threadId: thread, role, text: ` ${text}` } })
}

/** An answer a browser accepts for its offer: the same sections, each agreed to, from a peer that is never reached. */
function answerTo(offer) {
  const sections = offer.split(/\r?\n(?=m=)/).slice(1)
  const mid = (section) => section.match(/^a=mid:(.+)$/m)[1]
  const transport = ['c=IN IP4 0.0.0.0', 'a=ice-ufrag:fake', 'a=ice-pwd:fakefakefakefakefakefake', `a=fingerprint:sha-256 ${Array(32).fill('AB').join(':')}`, 'a=setup:passive']
  const out = ['v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 't=0 0', `a=group:BUNDLE ${sections.map(mid).join(' ')}`, 'a=ice-lite']
  for (const section of sections) {
    if (section.startsWith('m=audio')) {
      const opus = section.match(/^a=rtpmap:(\d+) opus\/48000\/2$/m)[1]
      out.push(`m=audio 9 UDP/TLS/RTP/SAVPF ${opus}`, ...transport, `a=mid:${mid(section)}`, 'a=sendrecv', 'a=rtcp-mux', `a=rtpmap:${opus} opus/48000/2`)
    } else out.push('m=application 9 UDP/DTLS/SCTP webrtc-datachannel', ...transport, `a=mid:${mid(section)}`, 'a=sctp-port:5000')
  }
  return out.join('\r\n') + '\r\n'
}

async function startCall(id, params) {
  if (!experimental) return refuse(id, 'thread/realtime/start requires experimentalApi capability')
  if (params.transport?.type !== 'webrtc' || params.version !== 'v3') return refuse(id, 'realtime conversation requires API key auth')
  answer(id, {})
  const offer = String(params.transport.sdp)
  // A real window's offer has sound in it; a test's own is only its script.
  const real = /^m=audio/m.test(offer)
  const lines = real ? (process.env.OPENKUMI_FAKE_CALL ?? '').split('|').filter(Boolean).map((line) => `a=${line}`) : offer.split(/\r?\n/)
  const refused = lines.find((l) => l.startsWith('a=refuse:'))
  // A refusal comes as a message of its own, after the request was taken.
  if (refused) return print({ method: 'thread/realtime/error', params: { threadId: thread, message: refused.slice(9) } })
  if (params.voice && !VOICES.includes(params.voice)) {
    return print({ method: 'thread/realtime/error', params: { threadId: thread, message: `realtime voice \`${params.voice}\` is not supported for v3; supported voices: ${VOICES.join(', ')}` } })
  }
  onCall = true
  const started = { voice: params.voice ?? null, prompt: params.prompt, initialItems: params.initialItems ?? [], includeStartupContext: params.includeStartupContext, clientManagedHandoffs: params.clientManagedHandoffs, instructions, opened, config, disabled: args.filter((_, i) => args[i - 1] === '--disable') }
  print({ method: 'thread/realtime/started', params: { threadId: thread, realtimeSessionId: thread, version: 'v3' } })
  print({ method: 'thread/realtime/sdp', params: { threadId: thread, sdp: real ? answerTo(offer) : `v=0\r\ns=${Buffer.from(JSON.stringify(started)).toString('base64')}\r\n` } })
  // The window takes a moment to be on the call.
  if (real) await sleep(400)
  let handoffs = 0
  const said = []
  for (const line of lines) {
    await sleep(40)
    if (!onCall) return
    if (line.startsWith('a=chat:')) {
      heard('user', line.slice(7))
      heard('assistant', `You said: ${line.slice(7)}`)
      said.push({ role: 'user', text: line.slice(7) }, { role: 'assistant', text: `You said: ${line.slice(7)}` })
    } else if (line.startsWith('a=says:')) {
      const words = line.slice(7)
      heard('user', words)
      said.push({ role: 'user', text: words })
      print({ method: 'thread/realtime/itemAdded', params: { threadId: thread, item: { type: 'handoff_request', handoff_id: `handoff_${++handoffs}`, item_id: `item_${handoffs}`, input_transcript: words, active_transcript: said.splice(0) } } })
      heard('assistant', 'On it.')
      said.push({ role: 'assistant', text: 'On it.' })
    }
  }
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line)
  if (method === 'initialize') {
    experimental = !!params.capabilities?.experimentalApi
    answer(id, { userAgent: 'fake-codex', platformOs: 'test' })
  } else if (method === 'thread/realtime/listVoices') {
    if (!experimental) refuse(id, 'thread/realtime/listVoices requires experimentalApi capability')
    else answer(id, { voices: { v1: ['juniper', 'cove'], v2: ['marin'], v3: VOICES, defaultV1: 'cove', defaultV2: 'marin' } })
  } else if (method === 'thread/realtime/start') void startCall(id, params)
  else if (method === 'thread/realtime/appendSpeech') {
    if (!onCall) refuse(id, 'conversation is not running')
    else {
      answer(id, {})
      heard('assistant', `Spoken: ${params.text}`)
    }
  } else if (method === 'thread/realtime/stop') {
    answer(id, {})
    if (onCall) print({ method: 'thread/realtime/closed', params: { threadId: thread, reason: 'requested' } })
    onCall = false
  }
  else if (method === 'thread/start' || method === 'thread/resume') {
    const session = method === 'thread/resume' ? params.threadId : crypto.randomUUID()
    if (method === 'thread/resume' && !fs.existsSync(file(session))) {
      refuse(id, `no rollout found for thread id ${session}`)
      continue
    }
    if (method === 'thread/start') fs.writeFileSync(file(session), JSON.stringify({ turn: 0 }))
    thread = session
    instructions = params.developerInstructions
    opened = { sandbox: params.sandbox, approvalPolicy: params.approvalPolicy, model: params.model ?? null, cwd: params.cwd, ...(params.ephemeral ? { ephemeral: true } : {}) }
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
