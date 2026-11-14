import fs from 'node:fs'
import path from 'node:path'
import * as agent from './agent.ts'
import { createBot, importLegacyBots, listBots, moveOffChatGPTSignIn } from './bots.ts'
import { stopAllBrowsers } from './browser.ts'
import { workspaceDir } from './config.ts'
import { closeAll } from './mcp.ts'
import * as db from './db.ts'
import { startServer } from './http.ts'
import { refreshProviders } from './providers/index.ts'
import { moveToSuperpowers } from './superpowers.ts'
import { startAutomations } from './automations.ts'
import { commit, scaffold } from './workspace.ts'

// Bots used to live in the database; write them out as folders once.
const legacy = db.legacyBots()
if (legacy) {
  await importLegacyBots(legacy)
  db.retireLegacyBots()
}

moveOffChatGPTSignIn()
moveToSuperpowers()

for (const bot of listBots()) {
  // A bot folder made by hand may have nothing but bot.md in it.
  if (!fs.existsSync(path.join(workspaceDir(bot.id), 'AGENTS.md'))) await scaffold(bot.id, bot.name)
  // Edits made while the server was not running are the owner's.
  else await commit(bot.id, 'you', 'Changes made outside OpenKumi')
}

if (!listBots().length) {
  await createBot({
    name: 'Assistant',
    emoji: '🤖',
    description: 'Everyday questions and tasks, and the first stop for anything new.',
    look: { creature: 'bear', color: 'sky', hat: 'headphones', extra: 'none', clothes: 'orange' },
    purpose: 'A capable general-purpose assistant. Concise, and researches before answering when facts matter.',
  })
}

const server = startServer()

// Automations start once the server is up, since a bot on an engine reaches its tools through it.
startAutomations()
// So do the bots that had messages waiting for them when the server last stopped.
agent.resumeQueues()

// Whether Claude Code and Codex are installed and signed in; found out in the background.
void refreshProviders()

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  server.close()
  // Replies being written are stopped first, so that what they had is saved before the database closes.
  await agent.stopAll()
  await Promise.all([stopAllBrowsers(), closeAll()])
  db.closeDb()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// A failed tool or a browser that went away must not take the whole server down.
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e))
