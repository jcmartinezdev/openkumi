// Whose bots the window shows, and where they are: picked at the top of the settings and of the
// sidebar, so it is always clear whom the app is being used for. On the computer that runs the
// bots, everyone with bots there has a server of their own, and the app can show any of them; a
// computer this app was paired with is one person's bots on that computer.
import { useEffect, useRef, useState } from 'react'
import { shownName, typedName } from '@openkumi/shared/people'
import { desktop, reason, useDesktop } from './desktop'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { openSettings, useStore } from './store'

/** A person's mark: the first letter of their name, on a colour of their own, the same wherever their name is shown. */
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  let hue = 0
  for (const char of name) hue = (hue * 31 + char.charCodeAt(0)) % 360
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: `hsl(${hue} 42% 46%)` }} aria-hidden>
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

/** Whose bots the window shows, as they are called, and the computer they are on. */
export function useShowing(): { name: string; where: string } {
  const app = useDesktop()
  // Said by the server itself; until it has, a computer elsewhere goes by what it said before, or the name it has here.
  const person = useStore((s) => s.about.person)
  const computer = useStore((s) => s.about.computer)
  if (app.current === 'local') return { name: shownName(app.local.person ?? person ?? '') || 'This computer', where: 'This computer' }
  const environment = app.environments.find((e) => e.id === app.current)
  const whose = person ?? environment?.person
  const label = environment?.name ?? 'Another computer'
  return { name: whose ? shownName(whose) : label, where: whose ? placeOf(label, whose, computer) : label }
}

/**
 * Where a computer elsewhere is, said once whose bots it holds is said beside it. The name pairing
 * gave it, "Ana on mac-mini", names her twice: then it is the computer, as that computer calls
 * itself. A name it was given here instead is kept as it is.
 */
function placeOf(label: string, whose: string, computer?: string): string {
  const prefix = `${shownName(whose)} on `
  const place = label.startsWith(prefix) ? label.slice(prefix.length) : label
  // Paired before the computer left the network's part out of its name: "mac-mini.fritz.box".
  return computer && place.split('.')[0].toLowerCase() === computer.toLowerCase() ? computer : place
}

/** One choice in the list: `mark` is whose name the mark is drawn from, when that is not what is shown. */
function Item({ name, mark, current, onClick }: { name: string; mark?: string; current: boolean; onClick: () => void }) {
  return (
    <button role="menuitemradio" aria-checked={current} className="switcher-item" onClick={onClick}>
      <Avatar name={mark ?? name} />
      <span className="grow">{name}</span>
      {current && <Icon name="check" size={14} />}
    </button>
  )
}

/** The switcher. `picked` is called when something in it was chosen, to close a drawer it is in. */
export function Switcher({ picked }: { picked?: () => void }) {
  const app = useDesktop()
  const { local } = app
  const showing = useShowing()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const people = local.enabled ? (local.people ?? []) : []
  const elsewhere = app.environments.filter((e) => e.enabled)
  const pick = (id: string, person?: string) => {
    setOpen(false)
    picked?.()
    void desktop.open(id, person).catch(() => {})
  }
  const go = (fn: () => void) => () => (setOpen(false), picked?.(), fn())
  // People are added by the app that runs everyone's servers here (see apps/desktop/src/people.ts).
  const canAdd = local.enabled && local.state === 'running' && local.startedHere && !!desktop.people

  return (
    // Escape closes the list first; only a second one reaches whatever the switcher is in.
    <div className="switcher" ref={box} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <button className="switcher-current" aria-haspopup="menu" aria-expanded={open} title={`${showing.name} · ${showing.where}`} aria-label={`Showing the bots of ${showing.name}, ${showing.where}. Switch`} onClick={() => setOpen(!open)}>
        <Avatar name={showing.name} />
        <span className="switcher-text">
          <strong>{showing.name}</strong>
          <small>{showing.where}</small>
        </span>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="switcher-menu" role="menu" aria-label="Whose bots to show">
          {local.enabled && <h4>On this computer</h4>}
          {people.map((name) => <Item key={name} name={shownName(name)} current={app.current === 'local' && local.person === name} onClick={() => pick('local', name)} />)}
          {/* While OpenKumi starts here, or one from before people had names runs here. */}
          {local.enabled && !people.length && <Item name="This computer" current={app.current === 'local'} onClick={() => pick('local')} />}
          {canAdd && (
            <button role="menuitem" className="switcher-item add" onClick={go(() => setAdding(true))}>
              <span className="switcher-plus"><Icon name="plus" size={14} /></span>
              <span className="grow">Add a person</span>
            </button>
          )}
          {local.enabled && <div className="switcher-sep" />}
          {elsewhere.length > 0 && <h4>Other computers</h4>}
          {elsewhere.map((e) => <Item key={e.id} name={e.name} mark={e.person && shownName(e.person)} current={app.current === e.id} onClick={() => pick(e.id)} />)}
          <button role="menuitem" className="switcher-item add" onClick={go(() => openSettings('environments', 'add'))}>
            <span className="switcher-plus"><Icon name="plus" size={14} /></span>
            <span className="grow">Connect to another computer</span>
          </button>
        </div>
      )}
      {adding && <AddPerson close={() => setAdding(false)} added={() => (setAdding(false), openSettings('profile'))} />}
    </div>
  )
}

/**
 * Someone else gets bots of their own on this computer. A name is all it takes: their server starts
 * at once, and the app shows them, on the page where their phone is paired.
 */
function AddPerson({ close, added }: { close: () => void; added: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = name.replace(/-+$/, '')
  const add = async () => {
    setError('')
    setBusy(true)
    try {
      await desktop.people!.add(ready)
      added()
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Add a person" close={close}>
      <div className="form">
        <p className="muted">They get bots of their own, kept apart from everyone else’s, and use them from their own computer or phone once it is paired. Their bots run on what this computer is signed in to.</p>
        <label>
          Their name
          <input autoFocus spellCheck={false} autoCapitalize="off" aria-label="Name of the person to add" value={name} placeholder="such as ana" onChange={(e) => setName(typedName(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void add()} />
          <small>Small letters, digits and dashes. Their server starts at once, and the app switches to them, ready to pair their phone.</small>
        </label>
        {error && <div className="notice error">{error}</div>}
        <div className="actions">
          <span className="grow" />
          <button className="ghost" onClick={close}>Cancel</button>
          <button className="primary" disabled={busy || !ready} onClick={() => void add()}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </Dialog>
  )
}
