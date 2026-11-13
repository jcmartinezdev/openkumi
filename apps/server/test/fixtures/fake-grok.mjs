#!/usr/bin/env node
// Stands in for the `grok` program in tests: same command line and output format, scripted replies.
// "!tool <name> <json>" calls a tool at the address in the folder's settings file, "!system" and
// "!args" report what it was started with, anything else is echoed with the turn number.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const print = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

if (args[0] === '--version') {
  console.log('grok 1.2.3 (abc) [stable]')
  process.exit(0)
}

if (args[0] === 'models') {
  console.log('You are logged in with grok.com.\n\nDefault model: grok-test\n\nAvailable models:\n  * grok-test (default)\n  - grok-test-fast')
  process.exit(0)
}

// The prompt file holds content blocks: the text, then any pictures.
const blocks = JSON.parse(fs.readFileSync(flag('--prompt-file'), 'utf8'))
const prompt = blocks[0].text
const shown = blocks.slice(1).map((block) => block.mimeType)
// The turn count lives in a file, like a real session, so a resumed conversation carries on from it.
const session = flag('--resume') ?? crypto.randomUUID()
const file = path.join(os.tmpdir(), `openkumi-fake-grok-${session}.json`)
const turn = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).turn : 0) + 1
fs.writeFileSync(file, JSON.stringify({ turn }))
print({ type: 'system', subtype: 'init', session_id: session })

let reply
const call = prompt.match(/^!tool (\w+)\s*([\s\S]*)$/)
if (call) {
  // The real program only reads this file in a folder it was told to trust.
  const settings = args.includes('--trust') ? fs.readFileSync(path.join(process.cwd(), '.grok', 'config.toml'), 'utf8') : ''
  const res = await fetch(JSON.parse(settings.match(/^url = (.*)$/m)[1]), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: call[1], arguments: JSON.parse(call[2] || '{}') } }),
  })
  reply = `Tool result: ${(await res.json()).result.content[0].text.slice(0, 600)}`
} else if (prompt === '!system') {
  reply = flag('--system-prompt-override')
} else if (prompt === '!args') {
  reply = JSON.stringify({ tools: flag('--tools'), mode: flag('--permission-mode'), sandbox: flag('--sandbox'), model: flag('--model') ?? null, cwd: process.cwd(), flags: args.filter((a) => a.startsWith('--')) })
} else {
  reply = `Echo (turn ${turn}): ${prompt}${shown.length ? ` [shown: ${shown.join(', ')}]` : ''}`
}

print({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } }, parent_tool_use_id: null })
print({ type: 'assistant', uuid: crypto.randomUUID(), message: { id: 'msg_0', content: [{ type: 'text', text: reply }] }, parent_tool_use_id: null })
print({ type: 'result', subtype: 'success', is_error: false, result: reply })
