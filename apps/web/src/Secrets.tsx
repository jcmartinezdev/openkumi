// A bot's secrets, as its owner looks after them: what each is, where it may be sent, who put it
// there and when it was last used. A value is typed in here and is not sent back, except to be
// read on the computer that runs OpenKumi. The bot itself only ever has the names.
import { type FormEvent, useState } from 'react'
import type { Bot, Secret } from '@openkumi/shared'
import { addSecret, howKept, removeSecret, saveSecret, secretStanding, showSecret, useSecrets } from '@openkumi/client/secrets'
import { Icon } from './Icon'
import { CopyButton, Page, Row, Section, onServer } from './settingsUi'

/** The fields of a secret: all of them for a new one; for one that is there, everything but its name, and a value only to replace it. */
function SecretForm({ bot, secret, done }: { bot: Bot; secret?: Secret; done: () => void }) {
  const [name, setName] = useState('')
  const [what, setWhat] = useState(secret?.what ?? '')
  const [sites, setSites] = useState(secret?.sites.join(', ') ?? '')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    // Adding never writes over one that is there: a name that is taken is said to be.
    ;(secret ? saveSecret(bot.id, secret.name, { what, sites, ...(value ? { value } : {}) }) : addSecret(bot.id, { name, what, sites, value }))
      .then(done, (e) => setError(e.message))
      .finally(() => setBusy(false))
  }
  const which = secret ? `“${secret.name}”` : 'new secret'
  return (
    <form className="secret-form" onSubmit={save}>
      {!secret && (
        <label>
          Name
          <input className="set-input" autoFocus autoCapitalize="off" spellCheck={false} aria-label="Name of the new secret" placeholder="plausible" value={name} onChange={(e) => setName(e.target.value)} />
          <small>What {bot.name} calls it. Lower-case letters, digits and “-”.</small>
        </label>
      )}
      <label>
        What it is
        <input className="set-input" aria-label={`What it is: ${which}`} placeholder="Plausible API key" value={what} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label>
        Sent only to
        <input className="set-input" autoCapitalize="off" spellCheck={false} aria-label={`Sites it is sent to: ${which}`} placeholder="plausible.io" value={sites} onChange={(e) => setSites(e.target.value)} />
        <small>The site it is for, exactly as its address names it. Separate several with commas.</small>
      </label>
      <label>
        {secret ? 'New value' : 'Value'}
        <input className="set-input" type="password" autoComplete="off" spellCheck={false} aria-label={`Value: ${which}`} placeholder={secret ? 'Leave empty to keep the one it has' : 'Paste or type it here'} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && <small className="err">{error}</small>}
      <div className="secret-form-actions">
        <button type="submit" className="primary" disabled={busy || (!secret && (!name.trim() || !value || !sites.trim()))}>{secret ? 'Save' : 'Add secret'}</button>
        <button type="button" className="ghost" disabled={busy} onClick={done}>Cancel</button>
      </div>
    </form>
  )
}

function SecretRow({ bot, secret }: { bot: Bot; secret: Secret }) {
  const [changing, setChanging] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const [error, setError] = useState('')
  const show = () => (shown === null ? showSecret(bot.id, secret.name).then((value) => (setError(''), setShown(value)), (e) => setError(e.message)) : setShown(null))
  const remove = () =>
    confirm(`Remove “${secret.name}” from ${bot.name}’s secrets? Its value is deleted. ${secret.by === 'bot' ? `${bot.name} kept it itself, so it may be written down nowhere else.` : 'What needs it will ask for it again.'}`) &&
    removeSecret(bot.id, secret.name).catch((e) => setError(e.message))
  return (
    <Row
      title={<><Icon name="key" size={15} />{secret.name}</>}
      description={`${secret.what ? `${secret.what}. ` : ''}Sent only to ${secret.sites.join(', ')}.`}
      status={secret.problem ? <span className="err">{secret.problem}</span> : error ? <span className="err">{error}</span> : secretStanding(secret, bot.name)}
      control={
        <>
          {/* Only the computer that runs OpenKumi is given a value to show. */}
          {onServer() && !secret.problem && <button className="ghost" aria-label={`${shown === null ? 'Show' : 'Hide'} the value of ${secret.name}`} aria-expanded={shown !== null} onClick={show}>{shown === null ? 'Show' : 'Hide'}</button>}
          <button className="ghost" aria-label={`Change ${secret.name}`} aria-expanded={changing} onClick={() => setChanging(!changing)}>{secret.problem ? 'Enter it again' : 'Change'}</button>
          <button className="ghost" aria-label={`Remove ${secret.name}`} onClick={remove}>Remove</button>
        </>
      }
    >
      {shown !== null && (
        <div className="secret-value">
          <code>{shown}</code>
          <CopyButton text={shown} label="Copy" />
        </div>
      )}
      {/* What was shown may be the value from before the change. */}
      {changing && <SecretForm bot={bot} secret={secret} done={() => (setChanging(false), setShown(null))} />}
    </Row>
  )
}

export function Secrets({ bot }: { bot: Bot }) {
  const { data, error } = useSecrets(bot.id)
  const [adding, setAdding] = useState(false)
  return (
    <Page>
      <p className="set-intro">
        {howKept(data?.kept ?? null)}
        {!onServer() && ' A value can be read back only on that computer.'}
      </p>
      {error && <div className="notice error">{error}</div>}
      <Section title="Secrets" action={!adding && data ? <button onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add a secret</button> : undefined}>
        {adding && (
          <Row title="New secret" description={`An API key, a password or a token for ${bot.name} to work with.`}>
            <SecretForm bot={bot} done={() => setAdding(false)} />
          </Row>
        )}
        {data?.secrets.map((secret) => <SecretRow key={secret.name} bot={bot} secret={secret} />)}
        {data && !data.secrets.length && !adding && (
          <Row title="None yet" description={`${bot.name} asks for one in the conversation when a task needs it, and you type it into a card there. Or add one here.`} />
        )}
        {!data && !error && <Row title="Loading…" />}
      </Section>
    </Page>
  )
}
