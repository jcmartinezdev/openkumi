// Takes the pictures of the app on the website (src/assets/screenshots) again, from the app as it is
// now. The desktop app runs from the source with a home of its own that is thrown away afterwards.
// Its bots run on stage-engine.mjs, a stand-in for the `claude` program with replies written for
// these scenes, so the subagents start and the browser opens for real. Each scene is taken in light
// and in dark, at 1440×900 points on a Retina screen.
//   npm run screenshots -w @openkumi/marketing
//   npm run screenshots -w @openkumi/marketing -- conversation browser   (only these)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron } from 'playwright-core'

const here = path.resolve(import.meta.dirname, '..')
const root = path.resolve(here, '../..')
const desktop = path.join(root, 'apps/desktop')
const SERVER = path.join(root, 'apps/server/src/index.ts')
const OUT = path.join(here, 'src/assets/screenshots')
const only = process.argv.slice(2)
const wanted = (scene) => !only.length || only.includes(scene)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-screenshots-'))
const home = path.join(tmp, 'home')
const PORT = 4890 + Math.floor(Math.random() * 50)
const env = {
  ...process.env,
  OPENKUMI_HOME: home,
  OPENKUMI_PORT: String(PORT),
  OPENKUMI_DESKTOP_DATA: path.join(tmp, 'app'),
  OPENKUMI_DESKTOP_HIDDEN: '1',
  OPENKUMI_DESKTOP_YES: '1',
  OPENKUMI_TELEMETRY: '0',
  OPENKUMI_CLAUDE_BIN: path.join(here, 'scripts/stage-engine.mjs'),
  // Only Claude Code is there, whatever else is installed here.
  OPENKUMI_CODEX_BIN: path.join(tmp, 'none'),
  OPENKUMI_GROK_BIN: path.join(tmp, 'none'),
}
delete env.ELECTRON_RUN_AS_NODE
delete env.OPENKUMI_DEV_URL
delete env.OPENKUMI_MOCK

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Gave up waiting for ${what}`)
    await sleep(250)
  }
}
const up = () => fetch(`http://127.0.0.1:${PORT}/api/hello`).then((r) => r.ok, () => false)
async function api(method, url, body) {
  const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`)
  return res.json()
}
const state = () => api('GET', '/api/state')
const itemsOf = async (threadId) => (await api('GET', `/api/threads/${threadId}`)).items.map((item) => item.data)
const conversationOf = async (botId) => (await state()).threads.find((t) => t.botId === botId && t.kind === 'chat' && !t.archivedAt)
/** Says something to a bot and waits for the answer that has `words` in it. */
async function say(botId, text, words) {
  const thread = await api('POST', `/api/bots/${botId}/messages`, { text })
  await until(async () => (await itemsOf(thread.id)).some((d) => d.type === 'message' && d.role === 'assistant' && d.text.includes(words)), `${botId} to answer`)
  await until(async () => (await state()).threads.every((t) => t.status !== 'running'), 'every bot to finish')
  return thread
}

// The bots in the pictures, dressed as the website's crew list has them.
const CREW = [
  { name: 'Researcher', emoji: '🔬', description: 'Digs into questions, compares options and cites its sources.', look: { creature: 'cat', color: 'periwinkle', hat: 'grad', extra: 'glasses', clothes: 'navy' }, model: '', effort: 'high' },
  { name: 'Inbox', emoji: '📬', description: 'Sorts mail and drafts the replies.', look: { creature: 'bunny', color: 'lemon', hat: 'cap', extra: 'none', clothes: 'teal' }, model: 'sonnet' },
  { name: 'Chef', emoji: '🍳', description: 'Plans the week’s meals and the shopping.', look: { creature: 'blob', color: 'tangerine', hat: 'chef', extra: 'bowtie', clothes: 'red' }, model: 'sonnet' },
  { name: 'Travel', emoji: '✈️', description: 'Finds flights and keeps the itinerary.', look: { creature: 'bug', color: 'mint', hat: 'beanie', extra: 'scarf', clothes: 'purple' }, model: 'sonnet' },
]

const HOUR = 3_600_000
let server
let app
try {
  for (const app of ['@openkumi/web', '@openkumi/desktop']) {
    const built = spawnSync('npm', ['run', 'build', '-w', app], { cwd: root, stdio: 'inherit' })
    if (built.status) throw new Error(`Building ${app} failed`)
  }

  // 1. The server alone, to set the scenes up.
  server = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' })
  await until(up, 'the server to start')
  const kumi = (await state()).bots[0]
  await api('PATCH', `/api/bots/${kumi.id}`, { provider: 'claude-code' })
  const bots = { kumi }
  for (const { name, ...rest } of CREW) bots[name.toLowerCase()] = await api('POST', '/api/bots', { name, provider: 'claude-code', ...rest })

  await say(kumi.id, 'Can you move my dentist appointment to Thursday afternoon?', 'Thursday at 16:30')
  await say(bots.inbox.id, 'Anything in my inbox that needs me today?', 'drafted replies')
  await say(bots.chef.id, 'What can I cook tonight with what’s in the fridge?', '35 minutes')
  await say(bots.researcher.id, 'Lisbon, Porto or Seville for a long weekend at the end of March? Compare the weather, getting there from Berlin and what a decent hotel costs, then pick one for me.', 'My pick: Lisbon')

  await api('POST', '/api/automations', { botId: bots.chef.id, title: 'Plan next week’s dinners', prompt: 'Plan dinners for next week from what I like and what is in season, and put the shopping list in my notes.', trigger: { kind: 'time', schedule: { type: 'daily', time: '17:00', days: [0] } } })
  await api('POST', '/api/automations', { botId: bots.inbox.id, title: 'Morning briefing', prompt: 'Go through what came in overnight and tell me what needs me today.', trigger: { kind: 'time', schedule: { type: 'daily', time: '07:30', days: [1, 2, 3, 4, 5] } } })
  for (const power of ['weather', 'exchange-rates', 'holidays']) await api('PUT', `/api/bots/${bots.researcher.id}/superpowers/${power}`, { on: true })

  server.kill('SIGTERM')
  await new Promise((resolve) => server.once('exit', resolve))
  server = null

  // 2. The conversations were had a while ago.
  const ago = { [kumi.id]: 2 * HOUR, [bots.inbox.id]: 5 * HOUR, [bots.chef.id]: 26 * HOUR, [bots.researcher.id]: 2 * 60_000 }
  const db = new DatabaseSync(path.join(home, 'openkumi.db'))
  for (const [botId, by] of Object.entries(ago)) {
    const end = db.prepare('SELECT MAX(updated_at) AS t FROM threads WHERE bot_id = ?').get(botId).t
    const shift = Date.now() - by - end
    db.prepare('UPDATE items SET created_at = created_at + ? WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)').run(shift, botId)
    db.prepare('UPDATE threads SET created_at = created_at + ?, updated_at = updated_at + ? WHERE bot_id = ?').run(shift, shift, botId)
  }
  db.close()

  // 3. The app, running the bots on this computer.
  const electron = (await import('electron')).default
  app = await _electron.launch({ executablePath: electron, args: ['.', '--force-device-scale-factor=2'], cwd: desktop, env })
  const win = await app.firstWindow()
  await win.locator('.welcome-start', { hasText: 'Run them on this computer' }).click()
  await win.locator('.sidebar .item', { hasText: 'Travel' }).waitFor({ timeout: 90_000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))

  const go = async (hash) => {
    await win.evaluate((to) => (location.hash = to), hash)
    await sleep(800)
  }
  /** The scene in light, then in dark. */
  async function shoot(name, settle = async () => {}) {
    if (!wanted(name)) return
    for (const theme of ['light', 'dark']) {
      await win.emulateMedia({ colorScheme: theme })
      // Away from anything that would show it is pointed at.
      await win.mouse.move(1420, 450)
      await sleep(600)
      await settle()
      await win.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) })
      console.log(`${name}-${theme}.png`)
    }
  }
  /** Opens a bot's conversation, once the model it is on is named. */
  const open = async (bot, model) => {
    await go('/')
    await win.locator('.sidebar .item', { hasText: bot.name }).first().click()
    await win.locator('.model-button-name', { hasText: model }).waitFor()
  }

  await open(bots.researcher, 'Claude Opus')
  await shoot('conversation')

  await go(`/settings/bots/${bots.researcher.id}`)
  await shoot('bot-settings')

  // Everyday, where the three it has are.
  await go(`/settings/bots/${bots.researcher.id}/superpowers`)
  await win.locator('.catalog-chips button', { hasText: 'Everyday' }).click()
  await shoot('superpowers')

  await go('/automations')
  await shoot('tasks', () => win.locator('.automation-card', { hasText: 'Morning briefing' }).waitFor())

  // Last, since Travel is still at work when it is taken, browsing.
  if (wanted('browser')) {
    await open(bots.travel, 'Claude Sonnet')
    const told = await api('POST', `/api/bots/${bots.travel.id}/messages`, { text: 'Put together three days in Lisbon for the end of March: what to see, where to eat and how to get around. Keep it relaxed.' })
    await until(async () => (await itemsOf(told.id)).filter((d) => d.type === 'function_call_output').length >= 2, 'Travel to browse')
    await sleep(3000)
    await shoot('browser')
    await api('POST', `/api/threads/${told.id}/stop`)
  }
} finally {
  await app?.close().catch(() => {})
  server?.kill('SIGTERM')
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
