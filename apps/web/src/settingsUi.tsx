// The building blocks of the settings pages: a page is a column of sections, a section is a titled
// card, and a card is a list of rows with a name and description on the left and a control on the
// right. A setting is saved the moment it is changed; there are no Save buttons.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Settings } from '@openbot/shared'
import { desktopState } from './desktop'
import { Icon } from './Icon'
import { PREF_DEFAULTS, type Prefs, setPrefs, usePrefs } from './prefs'
import { saveSettings, useStore } from './store'

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="set-scroll">
      <div className={`set-column ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="set-group">{children}</div>
    </section>
  )
}

/** The row a search result points at, so that row can show itself when its page opens. */
let wanted: string | null = null
export function pointAt(id: string | null) {
  wanted = id
}

interface RowProps {
  /** Lets the search in the sidebar bring this row into view. */
  id?: string
  title: ReactNode
  description?: ReactNode
  /** A line under the description for what is true right now, such as where a program was found. */
  status?: ReactNode
  /** Given when the value differs from its default: puts it back. */
  reset?: () => void
  control?: ReactNode
  /** Anything that needs the full width, shown under the row. */
  children?: ReactNode
}

export function Row({ id, title, description, status, reset, control, children }: RowProps) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!id || wanted !== id) return
    wanted = null
    row.current?.scrollIntoView({ block: 'center' })
    row.current?.classList.add('found')
  }, [id])
  return (
    <div className="set-row" id={id} ref={row}>
      <div className="set-row-main">
        <div className="set-row-text">
          <h3>
            {title}
            {reset && (
              <button className="icon set-reset" title="Reset to default" aria-label="Reset to default" onClick={reset}>
                <Icon name="undo" size={12} />
              </button>
            )}
          </h3>
          {description && <p>{description}</p>}
          {status && <p className="set-status">{status}</p>}
        </div>
        {control && <div className="set-control">{control}</div>}
      </div>
      {children}
    </div>
  )
}

// ---- controls

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <input type="checkbox" role="switch" className="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
}

export function Pick<T extends string | number>({ value, options, onChange, label, disabled }: { value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; label: string; disabled?: boolean }) {
  return (
    <select
      className="set-select"
      aria-label={label}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}
    >
      {options.map(([v, text]) => <option key={String(v)} value={String(v)}>{text}</option>)}
    </select>
  )
}

interface FieldProps {
  value: string
  /** Called when the field is left or Enter is pressed, if the text changed. */
  onCommit: (value: string) => void | Promise<unknown>
  label: string
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  /** For long text: a box of this many rows instead of one line. */
  rows?: number
  className?: string
}

/** A text box that keeps what is typed to itself until the field is left, then hands it over once. */
export function Field({ value, onCommit, label, placeholder, type = 'text', rows, className }: FieldProps) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  // What is shown follows the saved value, except while it is being edited.
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  const commit = async () => {
    editing.current = false
    if (draft === value) return
    setError('')
    try {
      await onCommit(draft)
    } catch (e: any) {
      setError(e.message)
    }
  }
  const shared = {
    className: className ?? 'set-input',
    'aria-label': label,
    value: draft,
    placeholder,
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => ((editing.current = true), setDraft(e.target.value)),
    onBlur: commit,
  }
  return (
    <>
      {rows ? (
        <textarea {...shared} rows={rows} spellCheck />
      ) : (
        <input {...shared} type={type} autoCapitalize="off" onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      )}
      {error && <small className="err">{error}</small>}
    </>
  )
}

// ---- reading and changing a setting

type Bind<T> = { value: T; set: (value: T) => void; reset: (() => void) | undefined }

/** One app-wide setting (kept on the server): its value, a way to change it, and a way back to the default when it differs. */
export function useSetting<K extends keyof Settings>(key: K): Bind<Settings[K]> {
  const value = useStore((s) => s.settings[key])
  const initial = useStore((s) => s.defaults[key])
  const set = (next: Settings[K]) => void saveSettings({ [key]: next }).catch((e) => alert(e.message))
  return { value, set, reset: JSON.stringify(value) === JSON.stringify(initial) ? undefined : () => set(initial) }
}

/** One preference of this device (kept by the app, not the environment). */
export function usePref<K extends keyof Prefs>(key: K): Bind<Prefs[K]> {
  const value = usePrefs()[key]
  const set = (next: Prefs[K]) => setPrefs({ [key]: next })
  return { value, set, reset: value === PREF_DEFAULTS[key] ? undefined : () => set(PREF_DEFAULTS[key]) }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return <button onClick={copy}>{copied ? <><Icon name="check" size={14} /> Copied</> : <><Icon name="copy" size={14} /> {label}</>}</button>
}

/** True when the environment being shown is on this computer, where sign-ins can finish and folders can be opened. */
export const onServer = () => !!desktopState().connection?.local
