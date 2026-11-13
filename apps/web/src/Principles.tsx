// Settings › Principles: what every bot is told before anything else, what each bot is for (which
// the others are told, so they know when to hand it work), and a way to read all a bot is told.
import { useState } from 'react'
import type { Bot } from '@openkumi/shared'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { Field, Page, Pick, Row, Section } from './settingsUi'
import { api, savePrinciples, useStore } from './store'
import { BotHead } from './Mascot'

export function Principles() {
  const principles = useStore((s) => s.principles)
  const bots = useStore((s) => s.bots)
  const [error, setError] = useState('')
  const save = (text: string | null) => {
    setError('')
    savePrinciples(text).catch((e) => setError(e.message))
  }
  const restore = () => confirm('Put back the principles OpenKumi comes with? Yours are replaced.') && save(null)

  return (
    <Page>
      <p className="set-intro">
        What every bot is told before anything else: how to behave, and how to work with the other bots. After these, each bot follows its own rules from you and the instructions it writes itself. Bots cannot change them.
      </p>
      {error && <div className="notice error">{error}</div>}
      <Section title="Principles" action={principles?.custom && <button onClick={restore}><Icon name="undo" size={14} /> Restore default</button>}>
        <Row
          id="principles"
          title="For every bot"
          description={<>Written in Markdown, and saved when you leave the box. Where a bot’s own rules from you say otherwise, its rules win. {principles?.custom ? 'These are your own.' : 'These are the ones OpenKumi comes with.'}</>}
        >
          <Field label="Principles for every bot" rows={18} className="set-input set-area" value={principles?.text ?? ''} placeholder="Nothing: bots are told no principles." onCommit={(text) => save(text)} />
        </Row>
      </Section>

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

/** Everything one bot is told before each turn of its conversation, to read while tuning the principles. */
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
        description="Everything a bot reads before each turn of its conversation: these principles, the other bots, its rules from you, its own instructions and notes, and how OpenKumi works."
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
