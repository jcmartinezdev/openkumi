// Settings › Master prompt: what each bot is for (which the others are told, so they know when to
// hand it work), and a way to read all a bot is told. The master prompt itself comes with OpenKumi
// and is the same for every bot: nothing here changes it.
import { useState } from 'react'
import type { Bot } from '@openkumi/shared'
import { Dialog } from './Modals'
import { Field, Page, Pick, Row, Section } from './settingsUi'
import { api, useStore } from './store'
import { BotHead } from './Mascot'

export function MasterPrompt() {
  const bots = useStore((s) => s.bots)

  return (
    <Page>
      <p className="set-intro">
        Every bot is told the same master prompt before each step: how to behave, how to work with the other bots, and how OpenKumi works. It comes with OpenKumi and cannot be changed. Into it go the line below for each bot, each bot’s rules from you, and the instructions it writes itself.
      </p>

      <Section title="What each bot is for">
        <Row
          id="team"
          title="The team"
          description="Every bot is told the others’ names and these lines, so it knows when to hand a task over. It hands one over as a subagent: the other bot does the task as itself, with its own logins and superpowers, and reports back. A bot cannot change its own line."
        />
        {bots.map((bot, i) => (
          <Row key={bot.id} title={<><BotHead bot={bot} />{bot.name}{i === 0 && bots.length > 1 && <span className="pill">Main assistant</span>}</>}>
            <Field label={`What ${bot.name} is for`} className="set-input set-line" value={bot.description} placeholder="Say in a line what it is for" onCommit={(description) => api('PATCH', `/api/bots/${bot.id}`, { description })} />
          </Row>
        ))}
      </Section>

      <Told bots={bots} />
    </Page>
  )
}

/** Everything one bot is told before each turn of its conversation, to read. */
function Told({ bots }: { bots: Bot[] }) {
  const [botId, setBotId] = useState('')
  const [shown, setShown] = useState<{ bot: Bot; text: string } | null>(null)
  const [error, setError] = useState('')
  const bot = bots.find((b) => b.id === botId) ?? bots[0]
  if (!bot) return null
  const show = async () => {
    setError('')
    try {
      const { text } = await api<{ text: string }>('GET', `/api/bots/${bot.id}/instructions`)
      setShown({ bot, text })
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <Section title="What a bot is told">
      <Row
        id="told"
        title="Read it all"
        description="Everything a bot reads before each turn of its conversation: the master prompt, with the other bots, its rules from you, and its own instructions and notes filled in."
        status={error && <span className="err">{error}</span>}
        control={
          <div className="set-link-row">
            <Pick label="Bot" value={bot.id} options={bots.map((b) => [b.id, `${b.emoji} ${b.name}`] as const)} onChange={setBotId} />
            <button onClick={show}>Show</button>
          </div>
        }
      />
      {shown && (
        <Dialog title={`What ${shown.bot.name} is told`} close={() => setShown(null)} full>
          <pre className="prompt-text">{shown.text}</pre>
        </Dialog>
      )}
    </Section>
  )
}
