// Reading what a subagent or a run of an automation reports back out of the tags the server wraps it
// in, as the server writes them (apps/server/src/automations.ts, agent.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseReport, reportWord } from '../src/reports.ts'

test('a run of an automation: its name, its run, how it went and what it said, Markdown and all', () => {
  const body = 'I renamed 1 new file:\n\n- `peter.txt` → `2026-11-14 Story.txt`'
  assert.deepEqual(parseReport(`<automation_result>\nAutomation "Desktop folder: rename new files" (automation: auto_nE2BY8wP, run: t_T3RH0pLt) — completed\n${body}\n</automation_result>`), {
    kind: 'automation',
    name: 'Desktop folder: rename new files',
    run: 't_T3RH0pLt',
    status: 'completed',
    body,
  })
})

test('a watch that was paused ran nothing, so there is no run to open', () => {
  const report = parseReport('<automation_result>\nAutomation "Shelf" (automation: auto_1) — paused\nIt was paused because what it watches could not be looked at: the shelf fell over\nNothing ran.\n</automation_result>')
  assert.equal(report?.run, undefined)
  assert.equal(report?.status, 'paused')
  assert.equal(report?.body, 'It was paused because what it watches could not be looked at: the shelf fell over\nNothing ran.')
})

test('a subagent opens its own thread', () => {
  assert.deepEqual(parseReport('<subagent_notification>\nSubagent "Research flights" (id: t_abc) — failed\nError: the site was down\n</subagent_notification>'), {
    kind: 'subagent',
    name: 'Research flights',
    run: 't_abc',
    status: 'failed',
    body: 'Error: the site was down',
  })
})

test('a report that says nothing, and text that is not a report', () => {
  assert.equal(parseReport('<automation_result>\nAutomation "Ping" (automation: auto_1, run: t_1) — completed\n\n</automation_result>')?.body, '')
  assert.equal(parseReport('Automation "Ping" (automation: auto_1) — completed\nhi'), null)
  assert.equal(parseReport('<automation_result>\nsomething else\n</automation_result>'), null)
})

test('how it went, in words', () => {
  assert.deepEqual(['completed', 'failed', 'paused', 'stopped'].map(reportWord), ['ran', 'failed', 'was paused', 'was stopped'])
})
