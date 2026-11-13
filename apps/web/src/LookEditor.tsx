// Choosing a bot's look: the emoji on its sign, the creature, its colour and what it wears. Each
// choice shows as the bot's own head wearing it. Used for a new bot and on a bot's settings page.
import { type CSSProperties, useState } from 'react'
import type { Look } from '@openkumi/shared'
import { BODY_COLORS, CLOTHES_COLORS, CREATURES, EXTRAS, HATS, SIGN_EMOJIS, surprise } from '@openkumi/client/mascot'
import { Icon } from './Icon'
import { Mascot } from './Mascot'

export interface Dress {
  look: Look
  emoji: string
}

interface LookEditorProps extends Dress {
  change: (patch: { look?: Partial<Look>; emoji?: string }) => void
  /** Has the bot's model choose; the editor shows it is busy until then. */
  pick: () => Promise<void>
}

export function LookEditor({ look, emoji, change, pick }: LookEditorProps) {
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  /** What is in the emoji box while it is being typed in, which may be nothing for a moment. */
  const [typed, setTyped] = useState<string | null>(null)
  const choose = async () => {
    setPicking(true)
    setError('')
    try {
      await pick()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPicking(false)
    }
  }

  /** One part to choose, each choice shown on the bot's head. */
  const parts = <K extends 'creature' | 'hat' | 'extra'>(title: string, key: K, names: Record<Look[K], string>) => (
    <div>
      <h4>{title}</h4>
      <div className="look-opts" role="group" aria-label={title}>
        {(Object.entries(names) as [Look[K], string][]).map(([value, name]) => (
          <button key={value} className="look-opt" aria-pressed={look[key] === value} onClick={() => change({ look: { [key]: value } })}>
            <Mascot look={{ ...look, [key]: value }} emoji={emoji} crop="head" />
            {name}
          </button>
        ))}
      </div>
    </div>
  )
  const colors = <K extends 'color' | 'clothes'>(title: string, key: K, names: Record<Look[K], { name: string; hex: string }>) => (
    <div>
      <h4>{title}</h4>
      <div className="look-swatches" role="group" aria-label={title}>
        {(Object.entries(names) as [Look[K], { name: string; hex: string }][]).map(([value, { name, hex }]) => (
          <button key={value} className="look-swatch" style={{ '--swatch': hex } as CSSProperties} title={name} aria-label={name} aria-pressed={look[key] === value} onClick={() => change({ look: { [key]: value } })} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="look-editor">
      <div className="actions">
        <button onClick={choose} disabled={picking}>
          {picking ? <span className="spinner" /> : <Icon name="sparkles" size={14} />}
          {picking ? 'Choosing…' : 'Pick for me'}
        </button>
        <button onClick={() => change(surprise())} disabled={picking}><Icon name="dice" size={14} /> Surprise me</button>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div>
        <h4>Sign</h4>
        <div className="look-emojis" role="group" aria-label="Emoji on the sign">
          <input
            aria-label="Emoji on the sign"
            value={typed ?? emoji}
            maxLength={8}
            // Selected, so that an emoji typed or picked replaces the one there.
            onFocus={(e) => e.target.select()}
            onChange={(e) => (setTyped(e.target.value), e.target.value.trim() && change({ emoji: e.target.value.trim() }))}
            onBlur={() => setTyped(null)}
          />
          {SIGN_EMOJIS.map((e) => (
            <button key={e} aria-pressed={emoji === e} aria-label={e} onClick={() => change({ emoji: e })}>{e}</button>
          ))}
        </div>
      </div>
      {parts('Creature', 'creature', CREATURES)}
      {colors('Colour', 'color', BODY_COLORS)}
      {parts('Hat', 'hat', HATS)}
      {parts('Extra', 'extra', EXTRAS)}
      {colors('Clothes colour', 'clothes', CLOTHES_COLORS)}
    </div>
  )
}
