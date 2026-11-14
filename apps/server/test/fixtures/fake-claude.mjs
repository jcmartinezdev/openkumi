#!/usr/bin/env node
// Stands in for the `claude` program in tests: same command line and output format, scripted replies.
// "!tool <name> <json>" calls a tool at the address it was given, "!system" and "!args" report what
// it was started with, "!slow" takes a while, anything else is echoed with the turn number and the
// kinds of the files it was shown. Asked to choose a bot's look, it gives one. Its input stays open
// while it works: a message marked to be read next is taken into the turn that is running, or
// answered in a turn of its own when none is.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const print = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

if (args[0] === '--version') {
  console.log('2.0.0 (Claude Code)')
  process.exit(0)
}

if (args[0] === 'auth' && args[1] === 'status') {
  print({ loggedIn: true, authMethod: 'claude.ai', email: 'test@example.com', subscriptionType: 'pro' })
  process.exit(0)
}

// Asked about itself instead of being given a message: it says which models it offers, as the real program does.
if (args.includes('--input-format') && !args.includes('--system-prompt')) {
  const levels = ['low', 'medium', 'high', 'xhigh', 'max']
  const models = [
    { value: 'default', resolvedModel: 'claude-opus-9', displayName: 'Default (recommended)', description: 'Opus 9 · Best for everyday tasks', supportedEffortLevels: levels },
    { value: 'opus', resolvedModel: 'claude-opus-9', displayName: 'Opus 9', description: 'For complex work', supportedEffortLevels: levels },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-9', displayName: 'Sonnet 9', description: 'Most efficient', supportedEffortLevels: levels },
    { value: 'haiku', resolvedModel: 'claude-haiku-9', displayName: 'Haiku 9', description: 'Fastest' },
    { value: 'claude-sonnet-8', resolvedModel: 'claude-sonnet-8', displayName: 'Sonnet 8', description: 'Efficient for routine tasks', supportedEffortLevels: ['low', 'medium', 'high'] },
  ]
  print({ type: 'control_response', response: { subtype: 'success', request_id: 'models', response: { models } } })
  process.exit(0)
}

// The turn count lives in a file, like a real session, so a resumed conversation carries on from it.
const session = flag('--resume') ?? crypto.randomUUID()
const file = path.join(os.tmpdir(), `openkumi-fake-claude-${session}.json`)
const turns = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).turn : 0)
if (flag('--resume') && !turns()) {
  print({ type: 'result', subtype: 'error_during_execution', is_error: true, result: `No conversation found with session ID: ${session}` })
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lifecycle = (uuid, state) => uuid && print({ type: 'command_lifecycle', command_uuid: uuid, state, session_id: session })

/** The turn that is running: what it has been told since it began. */
let active = null

/** One turn: answers the message, and whatever it is told as it works. */
async function run({ message, uuid }) {
  const prompt = message.content[0].text
  const shown = message.content.slice(1).map((block) => block.source.media_type)
  const turn = turns() + 1
  fs.writeFileSync(file, JSON.stringify({ turn }))
  const mine = (active = { told: [], uuids: uuid ? [uuid] : [] })
  print({ type: 'system', subtype: 'init', session_id: session })
  lifecycle(uuid, 'started')

  let reply
  const call = prompt.match(/^!tool (\w+)\s*([\s\S]*)$/)
  if (call) {
    const url = JSON.parse(flag('--mcp-config')).mcpServers.openkumi.url
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: call[1], arguments: JSON.parse(call[2] || '{}') } }),
    })
    reply = `Tool result: ${(await res.json()).result.content[0].text.slice(0, 600)}`
  } else if (flag('--system-prompt').startsWith('You dress up the mascot')) {
    // Asked to choose a bot's look, which it is given no tools for.
    const tools = Object.keys(JSON.parse(flag('--mcp-config')).mcpServers)
    reply = JSON.stringify({ creature: 'bunny', color: 'mint', hat: tools.length ? 'crown' : 'headband', extra: 'none', clothes: 'red', emoji: '🧬' })
  } else if (prompt === '!system') {
    reply = flag('--system-prompt')
  } else if (prompt === '!args') {
    reply = JSON.stringify({ tools: flag('--tools'), allowed: flag('--allowedTools'), model: flag('--model') ?? null, flags: args.filter((a) => a.startsWith('--')) })
  } else {
    // At work for a while, unless it is told something more, which it then answers too.
    if (prompt.startsWith('!slow')) for (let waited = 0; waited < 8000 && !mine.told.length; waited += 50) await sleep(50)
    reply = `Echo (turn ${turn}): ${prompt}${shown.length ? ` [shown: ${shown.join(', ')}]` : ''}`
  }
  if (mine.told.length) reply += ` [told as it worked: ${mine.told.join(' / ')}]`
  active = null

  print({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } } })
  // A thought and the text arrive as two events for the same message, as they do from the real program.
  print({ type: 'assistant', uuid: crypto.randomUUID(), message: { id: 'msg_1', content: [{ type: 'thinking', thinking: '' }] } })
  print({ type: 'assistant', uuid: crypto.randomUUID(), message: { id: 'msg_1', content: [{ type: 'text', text: reply }] } })
  for (const done of mine.uuids) lifecycle(done, 'completed')
  print({ type: 'result', subtype: 'success', is_error: false, result: reply })
}

// Each line of input is a message. One that arrives while a turn runs is taken into it; any other is a turn of its own, in the order they came.
let last = Promise.resolve()
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const said = JSON.parse(line)
  lifecycle(said.uuid, 'queued')
  if (active && said.priority === 'next') {
    active.told.push(said.message.content[0].text)
    active.uuids.push(said.uuid)
    lifecycle(said.uuid, 'started')
  } else last = last.then(() => run(said))
}
await last
