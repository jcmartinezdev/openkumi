// Choosing what a bot runs on, from the composer. Every provider the environment has is down the
// side; the models of the one picked are in the middle, by the names and versions the provider
// gives them; the reasoning levels of the bot's model are on the right. Typing searches the
// models of every provider. Picking a model of another provider moves the bot to that provider.
import { useEffect, useRef, useState } from 'react'
import type { Bot, Effort, ModelInfo, ProviderInfo } from '@openbot/shared'
import { Icon } from './Icon'
import { EFFORT_LABEL, effortsOf, loadModels, useModelLists } from './models'
import { setPrefs, usePrefs } from './prefs'
import { ProviderIcon } from './ProviderIcon'
import { api, openSettings, useStore } from './store'

interface Choice {
  provider: ProviderInfo
  info: ModelInfo
  /** What is stored for the bot: empty for the provider's own default, so the bot follows it if it changes. */
  model: string
  isDefault: boolean
  key: string
}

/** A provider's models as choices. Its first model is its default. */
function choicesOf(provider: ProviderInfo, models: ModelInfo[], bot: Bot): Choice[] {
  // A model the bot was given that the provider no longer lists is still its model, and is shown.
  const lost = bot.provider === provider.id && bot.model && !models.some((m) => m.id === bot.model) ? [{ id: bot.model, name: bot.model }] : []
  return [...models, ...lost].map((info, i) => ({ provider, info, model: i === 0 ? '' : info.id, isDefault: i === 0, key: `${provider.id}:${i === 0 ? '' : info.id}` }))
}

/** Shortcuts are shown, and read, the way this kind of computer writes them. */
const mac = navigator.platform.startsWith('Mac')

export function ModelPicker({ bot }: { bot: Bot }) {
  // Providers that are switched off in Settings are not offered at all.
  const providers = useStore((s) => s.providers).filter((p) => p.enabled !== false)
  const favorites = usePrefs().favoriteModels
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<string>(bot.provider)
  const [query, setQuery] = useState('')
  /** The row lit by the arrow keys or the pointer. Null until one of them is used: then the bot's own model is lit. */
  const [active, setActive] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  /** Where the pointer last was. A list that changes under a pointer at rest must not take the lit row from the keyboard. */
  const pointer = useRef('')

  const current = providers.find((p) => p.id === bot.provider)
  const ready = providers.filter((p) => p.connected)
  // Closed, only the bot's own provider is needed (for the button). Open, all of them.
  const lists = useModelLists(open ? ready.map((p) => p.id) : current?.connected ? [current.id] : [])
  const all = ready.flatMap((p) => choicesOf(p, lists.get(p.id) ?? [], bot))
  const isCurrent = (c: Choice) => c.provider.id === bot.provider && c.model === bot.model
  const chosen = all.find(isCurrent)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const inTab = all.filter((c) => (tab === 'favorites' ? favorites.includes(c.key) : c.provider.id === tab))
  // Earlier models stay folded away until asked for, except the one the bot is on.
  const folded = tab === 'favorites' || more ? [] : inTab.filter((c) => c.info.older && !isCurrent(c))
  const shown = searching ? all.filter((c) => words.every((word) => `${c.info.name} ${c.info.id} ${c.provider.name}`.toLowerCase().includes(word))) : inTab.filter((c) => !folded.includes(c))
  const picked = providers.find((p) => p.id === tab)
  // The row that is lit: the one last pointed at, kept inside the list as it is now, else the bot's own model.
  const lit = active === null ? Math.max(0, shown.findIndex(isCurrent)) : Math.min(active, shown.length - 1)
  /** Shows other models. Whatever was lit belonged to the list that is being left. */
  const show = (change: () => void) => (change(), setActive(null), search.current?.focus())

  const save = (patch: Partial<Bot>) => api('PATCH', `/api/bots/${bot.id}`, patch).catch((e) => alert(e.message))
  const choose = (choice: Choice) => {
    setOpen(false)
    if (isCurrent(choice)) return
    // A reasoning level the new model does not take is not carried over to it.
    const keeps = !bot.effort || effortsOf(choice.info).includes(bot.effort)
    void save({ provider: choice.provider.id, model: choice.model, ...(keeps ? {} : { effort: '' }) })
  }
  const star = (choice: Choice) => setPrefs({ favoriteModels: favorites.includes(choice.key) ? favorites.filter((k) => k !== choice.key) : [...favorites, choice.key] })

  useEffect(() => {
    if (!open) return
    // Starts on the bot's own provider, with the models asked for afresh: one may have been added since.
    setTab(bot.provider)
    setQuery('')
    setMore(false)
    setActive(null)
    for (const p of ready) void loadModels(p.id, true)
    search.current?.focus()
    const outside = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', outside)
    return () => window.removeEventListener('mousedown', outside)
  }, [open])
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, which is not an effect cleanup.
    root.current?.querySelector('.model-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [lit, open])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return (e.stopPropagation(), setOpen(false))
    // Command (Control elsewhere) with a number takes the model in that place.
    if ((mac ? e.metaKey : e.ctrlKey) && /^[1-9]$/.test(e.key) && shown[Number(e.key) - 1]) return (e.preventDefault(), choose(shown[Number(e.key) - 1]))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), setActive((shown.length ? lit + (e.key === 'ArrowDown' ? 1 : shown.length - 1) : 0) % Math.max(1, shown.length)))
    else if (e.key === 'Enter' && shown[lit]) (e.preventDefault(), choose(shown[lit]))
  }

  // The button says what the bot runs on now, and how hard it is set to think when that was chosen.
  const name = chosen?.info.name ?? (bot.model || 'Default')
  return (
    <div className="model-picker" ref={root}>
      <button type="button" className="model-button" aria-label="Model" aria-haspopup="dialog" aria-expanded={open} title={current ? `${current.name} · ${name}` : name} onClick={() => setOpen(!open)}>
        {current && <ProviderIcon provider={current} size={15} />}
        <span className="model-button-name">{name}</span>
        {bot.effort && <span className="model-button-effort">{EFFORT_LABEL[bot.effort]}</span>}
        <Icon name="chevron" size={11} />
      </button>
      {open && (
        <div className="model-pop" role="dialog" aria-label="Choose a model" onKeyDown={onKey}>
          <div className="model-cols">
            <div className="model-rail" role="tablist" aria-label="Providers" aria-orientation="vertical">
              <button role="tab" aria-selected={tab === 'favorites'} aria-label="Favorites" title="Favorites" className={`star ${tab === 'favorites' ? 'active' : ''}`} onClick={() => show(() => (setTab('favorites'), setQuery('')))}><Icon name="star" size={19} /></button>
              <hr />
              {providers.map((p) => (
                <button key={p.id} role="tab" aria-selected={tab === p.id} aria-label={p.name} title={p.connected ? p.name : `${p.name}: ${p.detail}`} className={`${tab === p.id && !searching ? 'active' : ''} ${p.connected ? '' : 'off'}`} onClick={() => show(() => (setTab(p.id), setQuery(''), setMore(false)))}>
                  <ProviderIcon provider={p} size={21} />
                </button>
              ))}
            </div>

            <div className="model-main">
              <label className="model-search">
                <Icon name="search" size={16} />
                <input ref={search} value={query} placeholder="Search models…" aria-label="Search models" spellCheck={false} onChange={(e) => show(() => setQuery(e.target.value))} />
              </label>
              <div className="model-list" role="listbox" aria-label="Models">
                {shown.map((choice, i) => (
                  <div key={choice.key} role="option" aria-selected={isCurrent(choice)} title={choice.info.description} className={`model-row ${i === lit ? 'active' : ''}`} onMouseMove={(e) => pointer.current !== `${e.clientX},${e.clientY}` && ((pointer.current = `${e.clientX},${e.clientY}`), setActive(i))} onClick={() => choose(choice)}>
                    <ProviderIcon provider={choice.provider} size={17} />
                    <span className="model-name">{choice.info.name}</span>
                    {isCurrent(choice) && <Icon name="check" size={15} />}
                    {choice.isDefault && choice.info.name !== 'Default' && <span className="model-tag">Default</span>}
                    {(searching || tab === 'favorites') && <span className="model-of">{choice.provider.name}</span>}
                    <span className="grow" />
                    <button
                      type="button"
                      className={`icon model-star ${favorites.includes(choice.key) ? 'on' : ''}`}
                      aria-label={favorites.includes(choice.key) ? `Remove ${choice.info.name} from favorites` : `Add ${choice.info.name} to favorites`}
                      aria-pressed={favorites.includes(choice.key)}
                      onClick={(e) => (e.stopPropagation(), star(choice))}
                    >
                      <Icon name="star" size={14} />
                    </button>
                    {i < 9 && <kbd>{mac ? '⌘' : 'Ctrl '}{i + 1}</kbd>}
                  </div>
                ))}
                {!searching && (folded.length > 0 || (more && inTab.some((c) => c.info.older))) && (
                  <button type="button" className="model-more" onClick={() => show(() => setMore(!more))}>{more ? 'Show fewer' : 'Show more'}</button>
                )}
                {!shown.length && (
                  <div className="model-empty">
                    {searching ? 'No model matches.'
                      : tab === 'favorites' ? 'Star a model to keep it here.'
                      : !picked?.connected ? (
                        <>
                          <p>{picked?.hint ?? `${picked?.name} is not connected.`}</p>
                          <button type="button" onClick={() => (setOpen(false), openSettings('providers', tab))}>Open provider settings</button>
                        </>
                      )
                      : lists.has(tab) ? 'This provider lists no models.' : 'Loading models…'}
                  </div>
                )}
              </div>
            </div>

            <Reasoning bot={bot} model={chosen?.info} save={save} />
          </div>

          <footer className="model-foot">
            <span className="model-foot-status">
              {picked ? <><ProviderIcon provider={picked} size={14} />{picked.name} · {picked.detail}</> : tab === 'favorites' ? 'Your starred models' : null}
            </span>
            <button type="button" className="ghost" onClick={() => (setOpen(false), openSettings('providers', ...(picked ? [picked.id] : [])))}><Icon name="sliders" size={14} /> Manage providers</button>
          </footer>
        </div>
      )}
    </div>
  )
}

/** The reasoning levels the bot's model takes. The one it uses by itself is marked; picking that one leaves the choice to the model. */
function Reasoning({ bot, model, save }: { bot: Bot; model: ModelInfo | undefined; save: (patch: Partial<Bot>) => void }) {
  const levels = effortsOf(model)
  const usual = model?.defaultEffort
  // With no level chosen the model uses its own; that is the one shown as picked, when it is known.
  const selected = bot.effort || usual || ''
  const set = (effort: Effort) => save({ effort: effort === usual ? '' : effort })
  return (
    <div className="model-effort" role="radiogroup" aria-label="Reasoning">
      <div className="model-effort-head">
        <span>Reasoning</span>
        <span className="faint">{model?.name.replace(/^Claude /, '')}</span>
      </div>
      {!levels.length && <p className="faint">This model has no reasoning setting.</p>}
      {levels.length > 0 && !usual && (
        <button type="button" role="radio" aria-checked={selected === ''} onClick={() => set('')}>Auto{selected === '' && <Icon name="check" size={15} />}</button>
      )}
      {levels.map((level) => (
        <button key={level} type="button" role="radio" aria-checked={selected === level} onClick={() => set(level)}>
          {EFFORT_LABEL[level]}
          {level === usual && <span className="faint">Default</span>}
          {selected === level && <Icon name="check" size={15} />}
        </button>
      ))}
    </div>
  )
}
