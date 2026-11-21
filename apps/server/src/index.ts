import fs from 'node:fs'
import path from 'node:path'
import * as agent from './agent.ts'
import { createBot, importLegacyBots, listBots, moveOffChatGPTSignIn } from './bots.ts'
import { stopAllBrowsers } from './browser.ts'
import { endCalls } from './calls.ts'
import { workspaceDir } from './config.ts'
import { closeAll } from './mcp.ts'
import * as db from './db.ts'
import { closeHooks, listen as openHooks } from './hooks.ts'
import { startServer } from './http.ts'
import { refreshProviders } from './providers/index.ts'
import { enabledSuperpowers, moveToSuperpowers } from './superpowers.ts'
import { crashed, engineName, failed, startTelemetry, stopTelemetry } from './telemetry.ts'
import { listComputers } from './clients.ts'
import { settings } from './settings.ts'
import { startAutomations } from './automations.ts'
import { RESTART, startUpdates } from './update.ts'
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
    name: 'Kumi',
    emoji: '🤖',
    description: 'Everyday questions and tasks, and the first stop for anything new.',
    look: { creature: 'bear', color: 'sky', hat: 'headphones', extra: 'none', clothes: 'orange' },
    purpose: 'A capable general-purpose assistant. Concise, and researches before answering when facts matter.',
  }, 'server')
}

const server = startServer()

// Automations start once the server is up, since a bot on an engine reaches its tools through it.
startAutomations()
// And the door for webhooks, when any is set up.
openHooks()
// So do the bots that had messages waiting for them when the server last stopped.
agent.resumeQueues()

// Whether Claude Code and Codex are installed and signed in; found out in the background.
void refreshProviders()

// What its makers are told of how it is used, once its owner has agreed (telemetry.ts): counts, never names.
startTelemetry({
  summary: () => {
    const bots = listBots()
    const automations = db.listAutomations()
    const started = (kind: string) => automations.filter((a) => a.trigger.kind === kind).length
    return {
      bots: bots.length,
      conversations: db.listThreads().filter((t) => t.kind === 'chat').length,
      automations_time: started('time'),
      automations_watch: started('watch'),
      automations_hook: started('hook'),
      superpowers: [...new Set(bots.flatMap((bot) => enabledSuperpowers(bot.id)))].sort(),
      engines: [...new Set(bots.map((bot) => engineName(bot.provider)))].sort(),
      paired: listComputers().length,
      lan: settings().lan,
      public_address: !!settings().hookAddress,
    }
  },
})

let closing = false
/** Stops cleanly. `code` is what the process ends with: RESTART asks whatever runs it to start it again. */
async function shutdown(code = 0) {
  if (closing) return
  closing = true
  server.close()
  closeHooks()
  // A call is hung up, and what was said on it kept, while the database is still open.
  endCalls()
  // Replies being written are stopped first, so that what they had is saved before the database closes.
  await agent.stopAll()
  await Promise.all([stopAllBrowsers(), closeAll(), stopTelemetry()])
  db.closeDb()
  process.exit(code)
}
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

// A server installed on its own keeps itself up to date (update.ts).
startUpdates({ working: agent.working, restart: () => void shutdown(RESTART) })

// A failed tool or a browser that went away must not take the whole server down.
process.on('unhandledRejection', (e) => {
  console.error('Unhandled rejection:', e)
  failed(e, 'background')
})
// An error nothing caught ends the server, as it would have without this. Where it happened is
// written down first, to be reported the next time the server starts.
process.on('uncaughtException', (e) => {
  console.error(e)
  crashed(e)
  process.exit(1)
})
