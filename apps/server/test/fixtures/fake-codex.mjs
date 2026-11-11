#!/usr/bin/env node
// Stands in for the `codex` program in tests: same command line and output format, scripted replies.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const print = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT')
  process.exit(0)
}
if (args[0] !== 'exec') process.exit(2)

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

let prompt = ''
for await (const chunk of process.stdin) prompt += chunk

const session = args[1] === 'resume' ? args[2] : crypto.randomUUID()
const file = path.join(os.tmpdir(), `openbot-fake-codex-${session}.json`)
const turn = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).turn : 0) + 1
fs.writeFileSync(file, JSON.stringify({ turn }))
print({ type: 'thread.started', thread_id: session })
print({ type: 'turn.started' })

let reply
const call = prompt.match(/^!tool (\w+)\s*([\s\S]*)$/)
if (call) {
  const res = await fetch(config['mcp_servers.openbot.url'], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: call[1], arguments: JSON.parse(call[2] || '{}') } }),
  })
  reply = `Tool result: ${(await res.json()).result.content[0].text.slice(0, 600)}`
} else if (prompt === '!system') {
  reply = config.developer_instructions
} else if (prompt === '!args') {
  reply = JSON.stringify({ config: { ...config, developer_instructions: undefined, 'mcp_servers.openbot.url': undefined }, disabled: args.filter((_, i) => args[i - 1] === '--disable'), flags: args.filter((a) => a.startsWith('--')) })
} else {
  reply = `Echo (turn ${turn}): ${prompt}`
}
print({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: reply } })
print({ type: 'turn.completed', usage: {} })
