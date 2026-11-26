// A bot's secrets, as its owner looks after them: what each is, where it may be sent, who put it
// there and when it was last used. A value is typed in here and is not sent back, except to be
// read on the computer that runs OpenKumi. The bot itself only ever has the names. The ones with a
// user name are its logins, listed first: accounts it signs in to by itself.
import { type FormEvent, useState } from 'react'
import type { Bot, Secret } from '@openkumi/shared'
import { addLogin, addSecret, howKept, howLogins, loginsOf, plainSecretsOf, removeSecret, saveSecret, secretStanding, showSecret, siteName, useSecrets } from '@openkumi/client/secrets'
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

/** The fields of a login: the site its form is on, the user name and the password. One that is there keeps its password unless a new one is typed. */
function LoginForm({ bot, login, done }: { bot: Bot; login?: Secret; done: () => void }) {
  const [sites, setSites] = useState(login?.sites.join(', ') ?? '')
  const [user, setUser] = useState(login?.user ?? '')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    ;(login ? saveSecret(bot.id, login.name, { sites, user, ...(value ? { value } : {}) }) : addLogin(bot.id, { sites, user, value }))
      .then(done, (e) => setError(e.message))
      .finally(() => setBusy(false))
  }
  const which = login ? `“${login.name}”` : 'new login'
  return (
    <form className="secret-form" onSubmit={save}>
      <label>
        Site
        <input className="set-input" autoFocus={!login} autoCapitalize="off" spellCheck={false} aria-label={`Site: ${which}`} placeholder="github.com" value={sites} onChange={(e) => setSites(e.target.value)} />
        <small>The site whose page asks for the password, exactly as its address names it. Some sign in on another address than their own, such as accounts.google.com. Separate several with commas.</small>
      </label>
      <label>
        User name
        <input className="set-input" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={`User name: ${which}`} placeholder="User name or e-mail" value={user} onChange={(e) => setUser(e.target.value)} />
        <small>{bot.name} is told this, and never the password.</small>
      </label>
      <label>
        {login ? 'New password' : 'Password'}
        <input className="set-input" type="password" autoComplete="off" spellCheck={false} aria-label={`Password: ${which}`} placeholder={login ? 'Leave empty to keep the one it has' : 'Paste or type it here'} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && <small className="err">{error}</small>}
      <div className="secret-form-actions">
        <button type="submit" className="primary" disabled={busy || !sites.trim() || !user.trim() || (!login && !value)}>{login ? 'Save' : 'Add login'}</button>
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
  const login = !!secret.user
  const remove = () =>
    confirm(
      login
        ? `Remove the login “${secret.name}” (${secret.user}) from ${bot.name}? Its password is deleted here, and ${bot.name} can no longer sign in to ${secret.sites.join(', ')} by itself. ${secret.by === 'bot' ? `${bot.name} made the account itself, so the password may be written down nowhere else.` : ''}`
        : `Remove “${secret.name}” from ${bot.name}’s secrets? Its value is deleted. ${secret.by === 'bot' ? `${bot.name} kept it itself, so it may be written down nowhere else.` : 'What needs it will ask for it again.'}`,
    ) && removeSecret(bot.id, secret.name).catch((e) => setError(e.message))
  return (
    <Row
      title={<><Icon name={login ? 'person' : 'key'} size={15} />{login ? `${secret.user} at ${siteName(secret.sites[0])}` : secret.name}</>}
      description={login ? `${secret.what ? `${secret.what}. ` : ''}Called “${secret.name}”. The password is entered only on ${secret.sites.join(', ')}.` : `${secret.what ? `${secret.what}. ` : ''}Sent only to ${secret.sites.join(', ')}.`}
      status={secret.problem ? <span className="err">{secret.problem}</span> : error ? <span className="err">{error}</span> : secretStanding(secret, bot.name)}
      control={
        <>
          {/* Only the computer that runs OpenKumi is given a value to show. */}
          {onServer() && !secret.problem && <button className="ghost" aria-label={`${shown === null ? 'Show' : 'Hide'} the ${login ? 'password' : 'value'} of ${secret.name}`} aria-expanded={shown !== null} onClick={show}>{shown === null ? 'Show' : 'Hide'}</button>}
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
      {changing && (login ? <LoginForm bot={bot} login={secret} done={() => (setChanging(false), setShown(null))} /> : <SecretForm bot={bot} secret={secret} done={() => (setChanging(false), setShown(null))} />)}
    </Row>
  )
}

export function Secrets({ bot }: { bot: Bot }) {
  const { data, error } = useSecrets(bot.id)
  const [adding, setAdding] = useState(false)
  const [addingLogin, setAddingLogin] = useState(false)
  const logins = data ? loginsOf(data.secrets) : []
  const secrets = data ? plainSecretsOf(data.secrets) : []
  return (
    <Page>
      <p className="set-intro">
        {howKept(data?.kept ?? null)}
        {!onServer() && ' A value can be read back only on that computer.'}
      </p>
      {error && <div className="notice error">{error}</div>}
      <Section title="Logins" action={!addingLogin && data ? <button onClick={() => setAddingLogin(true)}><Icon name="plus" size={14} /> Add a login</button> : undefined}>
        {addingLogin && (
          <Row title="New login" description={howLogins(bot.name)}>
            <LoginForm bot={bot} done={() => setAddingLogin(false)} />
          </Row>
        )}
        {logins.map((login) => <SecretRow key={login.name} bot={bot} secret={login} />)}
        {data && !logins.length && !addingLogin && (
          <Row title="None yet" description={`${howLogins(bot.name)} Add one here, or sign in yourself in ${bot.name}’s browser and say yes when you are asked whether to save it.`} />
        )}
        {!data && !error && <Row title="Loading…" />}
      </Section>
      <Section title="Secrets" action={!adding && data ? <button onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add a secret</button> : undefined}>
        {adding && (
          <Row title="New secret" description={`An API key, a password or a token for ${bot.name} to work with.`}>
            <SecretForm bot={bot} done={() => setAdding(false)} />
          </Row>
        )}
        {secrets.map((secret) => <SecretRow key={secret.name} bot={bot} secret={secret} />)}
        {data && !secrets.length && !adding && (
          <Row title="None yet" description={`${bot.name} asks for one in the conversation when a task needs it, and you type it into a card there. Or add one here.`} />
        )}
        {!data && !error && <Row title="Loading…" />}
      </Section>
    </Page>
  )
}
