#!/usr/bin/env node
// Stands in for the `claude` program while screenshots.mjs photographs the app: the same command
// line and output as the real one, with replies written for the scenes on the website. Its tool
// calls go to OpenKumi like a real model's do, so subagents start and the browser opens for real.
import crypto from 'node:crypto'
import fs from 'node:fs'
import readline from 'node:readline'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const print = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (args[0] === '--version') {
  console.log('2.1.0 (Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  print({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' })
  process.exit(0)
}
// Asked something about itself: which models it offers, or how much of the plan is used.
if (args.includes('--input-format') && !args.includes('--system-prompt-file')) {
  const { value: line } = await readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]().next()
  const asked = JSON.parse(line ?? '{}').request?.subtype
  if (asked === 'get_usage') {
    // A Max plan a fair way into its week, as the usage page shows it.
    const inHours = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString()
    const rate_limits = { five_hour: { utilization: 18, resets_at: inHours(3.2) }, seven_day: { utilization: 46, resets_at: inHours(62) }, model_scoped: [{ display_name: 'Opus', utilization: 31, resets_at: inHours(62) }] }
    print({ type: 'control_response', response: { subtype: 'success', request_id: asked, response: { subscription_type: 'max', rate_limits_available: true, rate_limits } } })
    process.exit(0)
  }
  const levels = ['low', 'medium', 'high', 'xhigh', 'max']
  const models = [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday tasks', supportedEffortLevels: levels },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work', supportedEffortLevels: levels },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Fast, for everyday tasks', supportedEffortLevels: levels },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: 'Fastest' },
  ]
  print({ type: 'control_response', response: { subtype: 'success', request_id: asked ?? 'models', response: { models } } })
  process.exit(0)
}

const session = flag('--resume') ?? crypto.randomUUID()
const system = () => fs.readFileSync(flag('--system-prompt-file'), 'utf8')

/** Calls one of OpenKumi's tools, as the real program does through the address it was given. */
async function tool(name, input) {
  const url = JSON.parse(flag('--mcp-config')).mcpServers.openkumi.url
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }),
  })
  return (await res.json()).result?.content?.[0]?.text ?? ''
}

const CITIES = {
  Lisbon: ['2000', 'Day 19°, night 11°. Some rain. Direct flights from Berlin daily, 3 h 50. A decent hotel: €120–160 a night.'],
  Porto: ['3500', 'Day 17°, night 9°. The rainiest of the three. Direct flights from Berlin, 3 h 40. A decent hotel: €90–130 a night.'],
  Seville: ['5000', 'Day 23°, night 10°. The least rain. Direct flights from Berlin some days, 3 h 45. A decent hotel: €110–150 a night. Holy Week can fall at the end of March.'],
}

const COMPARISON = `Here’s how they compare for the last weekend of March:

| | Lisbon | Porto | Seville |
|---|---|---|---|
| Weather | 19°, some rain | 17°, the wettest | 23°, the driest |
| From Berlin | Direct, 3 h 50 | Direct, 3 h 40 | Direct some days, 3 h 45 |
| Hotel a night | €120–160 | €90–130 | €110–150 |

**My pick: Lisbon.** Daily direct flights, so you can leave Friday after work, and mild enough for long walks without Seville’s Easter crowds. Porto is the bargain, if you don’t mind rain.`

/** What it says to a message, by what is in it; null when it has nothing more to say than its tool calls. */
async function answer(prompt) {
  if (system().startsWith('You dress up the mascot')) return '{"creature":"bear","color":"sky","hat":"headphones","extra":"none","clothes":"orange","emoji":"🤖"}'
  // The last of the three to finish brings the answer.
  if (prompt.includes('<subagent_notification>')) return prompt.includes('Subagent "Seville"') ? COMPARISON : null
  if (prompt.includes('Lisbon, Porto or Seville')) {
    for (const city of Object.keys(CITIES)) {
      await tool('spawn_subagent', { name: city, task: `Weekend in ${city}, last weekend of March, from Berlin: the weather, the flights and what a decent hotel costs a night. Report in three lines.` })
    }
    return null
  }
  // Kumi asks Travel for hotels, and passes on what comes back.
  if (prompt.includes('Can you ask Travel')) {
    const travel = JSON.parse(await tool('list_bots', {})).find((bot) => bot.name === 'Travel')
    await tool('message_bot', { bot_id: travel.id, message: 'Find two hotels in Lisbon for 27–29 March, under €160 a night and close to the river. Say what each costs and why it fits.', reply_wanted: true })
    return 'I’ve asked Travel to look. I’ll tell you what it finds.'
  }
  // Travel writes back to the bot that asked, as a real model would, with the same tool.
  if (prompt.includes('<bot_message from="Kumi"')) {
    await sleep(1500)
    const kumi = /<bot_message from="Kumi" bot_id="([^"]+)"/.exec(prompt)[1]
    // Plain words: a message between bots is shown as it was written, without Markdown.
    await tool('message_bot', { bot_id: kumi, message: 'Two that fit, both a short walk from the river. Hotel Bairro Alto, €148 a night: quiet rooms over the old town, and the tram stops at the door. Memmo Príncipe Real, €156 a night: a pool with a view of the castle, and breakfast is included.' })
    return 'I sent Kumi two hotels by the river: Hotel Bairro Alto at €148 a night, and Memmo Príncipe Real at €156.'
  }
  if (prompt.includes('<bot_message from="Travel"')) {
    return 'Travel found two, both close to the river: **Hotel Bairro Alto** at €148 a night, by the tram, and **Memmo Príncipe Real** at €156, with a pool and breakfast. Shall I ask it to book the first?'
  }
  // Inbox needs a choice before it can answer the landlord, so it asks with a card of answers.
  if (prompt.includes('Answer the landlord')) {
    await tool('ask_user', {
      questions: [
        {
          header: 'Repair',
          question: 'When can the engineer come to fix the boiler?',
          options: [
            { label: 'Tuesday morning', description: '8:00–12:00, when you work from home' },
            { label: 'Wednesday after 16:00', description: 'After your last meeting' },
            { label: 'Saturday, 10:00–13:00', description: 'The landlord said weekends cost extra' },
          ],
          multiple: true,
        },
        {
          header: 'Keys',
          question: 'Can a neighbour let the engineer in if you are out?',
          options: [{ label: 'No, I’ll be there' }, { label: 'Yes, Ana in 2B', description: 'She has your spare key' }],
        },
      ],
    })
    return 'I’ll write to the landlord once you’ve picked.'
  }
  // Kumi needs a key it does not have, and asks for it in a card that keeps it out of the conversation. Still waiting when the picture is taken.
  if (prompt.includes('visited my blog')) {
    await tool('ask_secret', { name: 'plausible', site: 'plausible.io', what: 'Plausible API key', where: 'https://plausible.io/settings/api-keys' })
    return null
  }
  const city = /Weekend in (\w+),/.exec(prompt)?.[1]
  if (city) {
    await sleep(Number(CITIES[city][0]))
    return CITIES[city][1]
  }
  if (prompt.includes('Put together three days in Lisbon')) {
    await tool('browser_navigate', { url: 'https://en.wikivoyage.org/wiki/Lisbon' })
    await sleep(1500)
    await tool('browser_scroll', { direction: 'down', pages: 2 })
    // Still reading when the picture is taken.
    await sleep(30 * 60_000)
    return null
  }
  const canned = [
    ['Can you move my dentist', 'Done: the dentist is now Thursday at 16:30, and I told the practice by email.'],
    ['Anything in my inbox', 'Three need you today: the landlord’s question about the boiler, a signature for the gym contract, and Ana asking about Saturday. I drafted replies to all three.'],
    ['What can I cook', 'A tray of roast vegetables with feta and lemon couscous: 35 minutes, and it uses up the peppers and courgette.'],
  ].find(([start]) => prompt.includes(start))
  return canned ? canned[1] : 'On it.'
}

async function run({ message, uuid }) {
  const prompt = message.content[0].text
  print({ type: 'system', subtype: 'init', session_id: session })
  if (uuid) print({ type: 'command_lifecycle', command_uuid: uuid, state: 'started', session_id: session })
  const reply = (await answer(prompt)) ?? ''
  if (reply) {
    print({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } } })
    print({ type: 'assistant', uuid: crypto.randomUUID(), message: { id: 'msg_1', content: [{ type: 'text', text: reply }] } })
  }
  if (uuid) print({ type: 'command_lifecycle', command_uuid: uuid, state: 'completed', session_id: session })
  print({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: session })
}

let last = Promise.resolve()
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const said = JSON.parse(line)
  last = last.then(() => run(said))
}
await last
