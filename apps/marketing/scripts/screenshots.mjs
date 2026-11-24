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

/** A server keeps its data in the folder of the person it runs for: the first one in its list of people. */
const dataOf = (home) => path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)

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
  // Whose bots they are, as the switcher at the top of the sidebar says: someone, and not whoever runs this.
  OPENKUMI_NAME: 'alex',
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
  const token = JSON.parse(fs.readFileSync(path.join(dataOf(home), 'auth.json'), 'utf8')).accessToken
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
  await say(kumi.id, 'Can you ask Travel to find a hotel in Lisbon for the last weekend of March? Under €160 a night, near the river.', 'Shall I ask it')
  await say(bots.researcher.id, 'Lisbon, Porto or Seville for a long weekend at the end of March? Compare the weather, getting there from Berlin and what a decent hotel costs, then pick one for me.', 'My pick: Lisbon')

  await api('POST', '/api/automations', { botId: bots.chef.id, title: 'Plan next week’s dinners', prompt: 'Plan dinners for next week from what I like and what is in season, and put the shopping list in my notes.', trigger: { kind: 'time', schedule: { type: 'daily', time: '17:00', days: [0] } } })
  await api('POST', '/api/automations', { botId: bots.inbox.id, title: 'Morning briefing', prompt: 'Go through what came in overnight and tell me what needs me today.', trigger: { kind: 'time', schedule: { type: 'daily', time: '07:30', days: [1, 2, 3, 4, 5] } } })
  for (const power of ['weather', 'exchange-rates', 'holidays']) await api('PUT', `/api/bots/${bots.researcher.id}/superpowers/${power}`, { on: true })
  // The other two ways an automation starts: a page that changes, on a lighter model of its own, and an app that calls.
  // A watch looks at its page once when it is made, which needs the internet: without it, the other scenes are still taken.
  await api('POST', '/api/automations', { botId: kumi.id, title: 'What’s new in OpenKumi', prompt: 'Read the new release notes and tell me in three lines what changed for me.', trigger: { kind: 'watch', watch: { on: 'page', url: 'https://github.com/jcmartinezdev/openkumi/releases', every: 360 } }, runsOn: { provider: 'claude-code', model: 'haiku' } }).catch((e) =>
    console.warn(`The automations picture will have no page watch: ${e.message}`),
  )
  // Linear is switched on as a sign-in would, there being no account to sign in with: only the automation's card shows it.
  fs.writeFileSync(path.join(dataOf(home), 'bots', kumi.id, 'superpowers.json'), JSON.stringify({ on: ['linear'] }))
  await api('PUT', `/api/bots/${kumi.id}/hooks/linear`, {})
  await api('POST', '/api/automations', { botId: kumi.id, title: 'Sort new issues', prompt: 'Give the new issue a priority and a label, and tell me only if it is urgent.', trigger: { kind: 'hook', hook: { power: 'linear', events: ['issue.created'] } } })

  server.kill('SIGTERM')
  await new Promise((resolve) => server.once('exit', resolve))
  server = null

  // 2. The conversations were had a while ago.
  const ago = { [kumi.id]: 2 * HOUR, [bots.travel.id]: 2 * HOUR + 60_000, [bots.inbox.id]: 5 * HOUR, [bots.chef.id]: 26 * HOUR, [bots.researcher.id]: 2 * 60_000 }
  const db = new DatabaseSync(path.join(dataOf(home), 'openkumi.db'))
  for (const [botId, by] of Object.entries(ago)) {
    const end = db.prepare('SELECT MAX(updated_at) AS t FROM threads WHERE bot_id = ?').get(botId).t
    const shift = Date.now() - by - end
    db.prepare('UPDATE items SET created_at = created_at + ? WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)').run(shift, botId)
    db.prepare('UPDATE threads SET created_at = created_at + ?, updated_at = updated_at + ? WHERE bot_id = ?').run(shift, shift, botId)
  }
  // Three months of what the bots used, for the usage page, which shows the last one: more on weekdays, most by the bot on the biggest model.
  const use = db.prepare('INSERT INTO usage (hour, bot_id, provider, model, costed, input, cached, output, cost) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)')
  const PRICES = { 'claude-opus-5-5': [5, 0.5, 25], 'claude-sonnet-5-5': [3, 0.3, 15], 'claude-haiku-5-5': [1, 0.1, 5] }
  const busy = [[kumi.id, 'claude-opus-5-5', 1.1], [bots.researcher.id, 'claude-opus-5-5', 1.9], [bots.inbox.id, 'claude-sonnet-5-5', 1.3], [bots.chef.id, 'claude-sonnet-5-5', 0.5], [bots.travel.id, 'claude-sonnet-5-5', 0.8], [kumi.id, 'claude-haiku-5-5', 0.25]]
  const today = Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR
  for (let day = 0; day < 92; day++) {
    const hour = today - day * 24 * HOUR
    const weekend = [0, 6].includes(new Date(hour).getDay())
    busy.forEach(([botId, model, share], i) => {
      // The same month every time it is taken: a wave over the days rather than chance.
      const tokens = Math.round(share * (weekend ? 0.45 : 1) * (0.7 + 0.3 * Math.sin(day * 1.7 + i)) * 1_400_000)
      const cached = Math.round(tokens * 0.62)
      const output = Math.round(tokens * 0.05)
      const [inPrice, cachedPrice, outPrice] = PRICES[model]
      use.run(hour, botId, 'claude-code', model, tokens, cached, output, ((tokens - cached) * inPrice + cached * cachedPrice + output * outPrice) / 1e6)
    })
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
      // Away from anything that would show it is pointed at, or that it has the keyboard.
      await win.mouse.move(1420, 450)
      await win.evaluate(() => document.activeElement?.blur())
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

  await open(kumi, 'Claude Opus')
  await shoot('together')

  await go('/-usage')
  // Once Claude Code has said how much of the plan is used.
  await shoot('usage', () => win.getByText('5-hour session').waitFor())

  await go(`/settings/bots/${bots.researcher.id}`)
  await shoot('bot-settings')

  // Everyday, where the three it has are.
  await go(`/settings/bots/${bots.researcher.id}/superpowers`)
  await win.locator('.catalog-chips button', { hasText: 'Everyday' }).click()
  await shoot('superpowers')

  await go('/automations')
  await shoot('tasks', () => win.locator('.automation-card', { hasText: 'Sort new issues' }).waitFor())

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
  // The server lets go of its database before its folder is taken away.
  if (server && server.exitCode === null) {
    const gone = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await Promise.race([gone, sleep(10_000)])
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
