// What a bot has for a turn that answers a call (tools.ts onACall): only the tools that pass work
// on, an automation only when it starts at a time, and a note of what was passed on.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-call-tools-'))
process.env.OPENKUMI_HOME = home
const { onACall, passedOnAt } = await import('../src/tools.ts')
const db = await import('../src/db.ts')

after(() => {
  db.closeDb()
  fs.rmSync(home, { recursive: true, force: true })
})

test('on a call a bot only passes work on, and an automation that starts on a watch or when an app calls is neither made nor changed', async () => {
  const ran = []
  const tool = (name) => ({
    name,
    description: '',
    parameters: {},
    run: (a, ctx) => {
      ran.push([name, a])
      // As the real one does: the record of the message is in the conversation by the time it returns.
      if (name === 'message_bot') db.addItem(ctx.thread.id, { type: 'sent', to: { id: a.bot_id, name: a.bot_id }, threadId: 't_peer', text: a.message, replyWanted: true, key: a.key })
      return name === 'spawn_subagent' ? '{"id":"t_started"}' : name === 'create_automation' ? 'Scheduled.\n{\n "id": "auto_made"\n}' : 'ok'
    },
  })
  const tools = Object.fromEntries(
    onACall(['write_file', 'browser_navigate', 'spawn_subagent', 'wait_subagents', 'message_subagent', 'message_bot', 'create_automation', 'update_automation'].map(tool)).map((t) => [t.name, t]),
  )
  assert.deepEqual(Object.keys(tools), ['spawn_subagent', 'message_subagent', 'message_bot', 'create_automation', 'update_automation'])
  const passed = (what) => passedOnAt(what) >= since

  const automation = (id, trigger) =>
    db.saveAutomation({ id, botId: 'bot', title: id, prompt: 'p', trigger, enabled: false, createdBy: 'bot', nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null, lastThreadId: null, lastCheck: null, createdAt: 1, updatedAt: 1 })
  automation('auto_watch', { kind: 'watch', watch: { every: 15, track: [], on: 'page', url: 'https://example.com/' } })
  automation('auto_hook', { kind: 'hook', hook: { power: 'linear', app: 'Linear', events: [] } })
  automation('auto_time', { kind: 'time', schedule: { type: 'interval', minutes: 60 } })
  const refused = /On a call an automation can only be made or changed when it starts at a time/
  const since = Date.now()

  // Making one on a watch or a webhook would look at a page or an app there and then; so would turning one on again, or moving it.
  await assert.rejects(tools.create_automation.run({ title: 'W', prompt: 'p', watch: { url: 'https://example.com/' } }), refused)
  await assert.rejects(tools.create_automation.run({ title: 'H', prompt: 'p', hook: { app: 'linear' } }), refused)
  await assert.rejects(tools.update_automation.run({ id: 'auto_watch', paused: false }), refused)
  await assert.rejects(tools.update_automation.run({ id: 'auto_watch', bot_id: 'other' }), refused)
  await assert.rejects(tools.update_automation.run({ id: 'auto_hook', title: 'New name' }), refused)
  await assert.rejects(tools.update_automation.run({ id: 'auto_time', watch: { url: 'https://example.com/' } }), refused)
  assert.deepEqual(ran, [], 'none of them reached the tool')
  assert.ok(!passed('auto_watch') && !passed('auto_time'))

  // One that starts at a time is made and changed, and what was passed on is noted, for the call to say what comes back of it.
  // (A model may fill what it does not use with nothing.)
  assert.match(await tools.create_automation.run({ title: 'Later', prompt: 'p', in_minutes: 5, watch: null, hook: '' }), /^Scheduled\./)
  assert.equal(await tools.update_automation.run({ id: 'auto_time', paused: true }), 'ok')
  await tools.spawn_subagent.run({ name: 'Look', task: 'Look it up.' })
  await tools.message_subagent.run({ id: 't_earlier', message: 'One more thing.' })
  // A message to another bot is noted by its key, which the record of it in the conversation has: the reply names it.
  // So is each of two sent in the same moment, as a model does that asks two bots at once.
  const conversation = db.createThread({ botId: 'bot' })
  db.addItem(conversation.id, { type: 'sent', to: { id: 'travel', name: 'Travel' }, threadId: 't_travel', text: 'An earlier one.', replyWanted: true, key: 'm_earlier' })
  await Promise.all([
    tools.message_bot.run({ bot_id: 'travel', message: 'Find a flight.', key: 'm_one' }, { thread: conversation }),
    tools.message_bot.run({ bot_id: 'money', message: 'What may it cost?', key: 'm_two' }, { thread: conversation }),
  ])
  assert.deepEqual(ran.map(([name]) => name), ['create_automation', 'update_automation', 'spawn_subagent', 'message_subagent', 'message_bot', 'message_bot'])
  assert.deepEqual(['auto_made', 'auto_time', 't_started', 't_earlier', 'message:m_one', 'message:m_two', 'message:m_earlier', 't_other'].map(passed), [true, true, true, true, true, true, false, false])
  assert.ok(passedOnAt('t_started') < Date.now() + 1000, 'not for a call that began after')
})
