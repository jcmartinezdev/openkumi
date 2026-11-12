import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Bot, Look } from '@openbot/shared'
import { UNDECIDED, describeLook } from '@openbot/client/mascot'
import { Icon } from './Icon'
import { type Dress, LookEditor } from './LookEditor'
import { Mascot } from './Mascot'
import { api } from './store'

export function Dialog({ title, close, wide, full, children }: { title: string; close: () => void; wide?: boolean; full?: boolean; children: React.ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null)
  const latestClose = useRef(close)
  latestClose.current = close
  // Read during the first render, before any autofocus inside the dialog moves focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    // Move focus into the dialog, keep Tab inside it, and give focus back to the opener afterwards.
    const el = dialog.current!
    if (!el.contains(document.activeElement)) el.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return latestClose.current()
      if (e.key !== 'Tab') return
      const stops = [...el.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, textarea, select, summary')].filter((s) => s.offsetParent)
      const first = stops[0]
      const last = stops.at(-1)
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) (e.preventDefault(), last?.focus())
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // The opener may be gone or hidden (the phone drawer closes behind a dialog).
      const visible = (el?: HTMLElement | null) => (el?.isConnected && el.checkVisibility?.({ visibilityProperty: true }) ? el : null)
      // A row's action button hides again once focus leaves the row; its link is the next best place.
      const target = visible(opener) ?? visible(opener?.closest('.item')?.querySelector<HTMLElement>('a.row')) ?? document.querySelector<HTMLElement>('.menu')
      target?.focus()
    }
  }, [])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`dialog ${wide ? 'wide' : ''} ${full ? 'full' : ''}`} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon" onClick={close} title="Close" aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * A new bot needs only a name; what it is for becomes the start of the instructions it then keeps
 * itself. Its look can be chosen here; otherwise the bot chooses its own once it is made.
 */
export function NewBot({ close, created }: { close: () => void; created: (bot: Bot) => void }) {
  const [form, setForm] = useState({ name: '', purpose: '' })
  /** Null while the look is left to the bot. */
  const [dress, setDress] = useState<Dress | null>(null)
  const [error, setError] = useState('')
  const field = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const change = (patch: { look?: Partial<Look>; emoji?: string }) =>
    setDress((d) => ({ look: { ...(d?.look ?? UNDECIDED), ...patch.look }, emoji: patch.emoji ?? d?.emoji ?? '🤖' }))

  const save = async () => {
    try {
      // What it runs on is left to the server: the default from Settings, else the first provider that is connected.
      created(await api<Bot>('POST', '/api/bots', { ...form, ...dress }))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <Dialog title="New bot" close={close} wide>
      <div className="form">
        <div className="new-bot">
          <div className="new-bot-mascot">
            {/* A blank blob holding sparkles: the bot is yet to dress. */}
            <Mascot look={dress?.look ?? UNDECIDED} emoji={dress?.emoji ?? '✨'} live />
            <p>{dress ? describeLook(dress.look) : `${form.name.trim() || 'The bot'} chooses its own look once it is made.`}</p>
          </div>
          <div className="form nested">
            <label>
              Name
              <input autoFocus value={form.name} placeholder="Name" onChange={(e) => field('name', e.target.value)} />
            </label>
            <label>
              What is it for?
              <textarea rows={4} value={form.purpose} placeholder="A sentence or two is enough. The bot writes and updates its own instructions from here." onChange={(e) => field('purpose', e.target.value)} />
            </label>
            {dress ? (
              <>
                <div className="actions"><button className="ghost" onClick={() => setDress(null)}><Icon name="undo" size={14} /> Let {form.name.trim() || 'the bot'} choose</button></div>
                <LookEditor look={dress.look} emoji={dress.emoji} change={change} pick={async () => setDress(await api<Dress>('POST', '/api/looks/pick', form))} />
              </>
            ) : (
              <div className="actions"><button onClick={() => change({})}>Choose a look</button></div>
            )}
          </div>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="actions">
          <span className="grow" />
          <button className="ghost" onClick={close}>Cancel</button>
          <button className="primary" disabled={!form.name.trim()} onClick={save}>Create</button>
        </div>
      </div>
    </Dialog>
  )
}
