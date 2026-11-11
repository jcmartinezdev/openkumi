// Choosing what a bot runs on, from the composer. Every provider the environment has is down the
// side and the models of the one picked are beside it, by the names and versions the provider gives
// them and with what each is for. The bot's own model opens up to show its reasoning levels, as on
// the phone. Typing searches the models of every provider, and picking a model of another provider
// moves the bot to that provider. A click keeps the picker open, so a model and its reasoning can be
// picked in one go; Enter and Command (Control elsewhere) with a number pick and close it.
import { Fragment, useEffect, useRef, useState } from 'react'
import type { Bot, Effort, ModelInfo } from '@openbot/shared'
import { Icon } from './Icon'
import { type Choice, EFFORT_LABEL, choicesOf, effortsOf, loadModels, switchTo, useModelLists } from '@openbot/client/models'
import { setPrefs, usePrefs } from './prefs'
import { ProviderIcon } from './ProviderIcon'
import { api, openSettings, useStore } from './store'

/** Shortcuts are shown, and read, the way this kind of computer writes them. */
const mac = navigator.platform.startsWith('Mac')

export function ModelPicker({ bot: stored }: { bot: Bot }) {
  // Providers that are switched off in Settings are not offered at all.
  const providers = useStore((s) => s.providers).filter((p) => p.enabled !== false)
  const favorites = usePrefs().favoriteModels
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<string>(stored.provider)
  const [query, setQuery] = useState('')
  /** The row lit by the arrow keys or the pointer. Null until one of them is used: then the bot's own model is lit. */
  const [active, setActive] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  /** Where the pointer last was. A list that changes under a pointer at rest must not take the lit row from the keyboard. */
  const pointer = useRef('')
  /** What was just picked, shown at once instead of when the server has said so. */
  const [picked, setPicked] = useState<Partial<Bot> | null>(null)
  // The server's word replaces what was shown in the meantime.
  useEffect(() => setPicked(null), [stored])
  const bot = { ...stored, ...picked }

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
  const viewed = providers.find((p) => p.id === tab)
  // The row that is lit: the one last pointed at, kept inside the list as it is now, else the bot's own model.
  const lit = active === null ? Math.max(0, shown.findIndex(isCurrent)) : Math.min(active, shown.length - 1)
  /** Shows other models. Whatever was lit belonged to the list that is being left. */
  const show = (change: () => void) => (change(), setActive(null), search.current?.focus())

  const save = (patch: Partial<Bot>) => {
    setPicked((before) => ({ ...before, ...patch }))
    api('PATCH', `/api/bots/${bot.id}`, patch).catch((e) => (setPicked(null), alert(e.message)))
  }
  /** Puts the bot on a model. The keyboard's pick is final and closes the picker; a click leaves it open for the reasoning. */
  const choose = (choice: Choice, close: boolean) => {
    if (close) setOpen(false)
    if (!isCurrent(choice)) save(switchTo(bot, choice))
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
    if ((mac ? e.metaKey : e.ctrlKey) && /^[1-9]$/.test(e.key) && shown[Number(e.key) - 1]) return (e.preventDefault(), choose(shown[Number(e.key) - 1], true))
    // The arrows and Enter move through the list from the search box. On the reasoning levels they are the buttons' own.
    if (e.target !== search.current) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), setActive((shown.length ? lit + (e.key === 'ArrowDown' ? 1 : shown.length - 1) : 0) % Math.max(1, shown.length)))
    else if (e.key === 'Enter' && shown[lit]) (e.preventDefault(), choose(shown[lit], true))
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
                  <Fragment key={choice.key}>
                    <div
                      role="option"
                      aria-selected={isCurrent(choice)}
                      title={choice.info.description}
                      className={`model-row ${i === lit ? 'active' : ''}`}
                      onMouseMove={(e) => pointer.current !== `${e.clientX},${e.clientY}` && ((pointer.current = `${e.clientX},${e.clientY}`), setActive(i))}
                      // Typing goes on searching after a click.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(choice, false)}
                    >
                      <ProviderIcon provider={choice.provider} size={18} />
                      <span className="model-text">
                        <span className="model-line">
                          <span className="model-name">{choice.info.name}</span>
                          {choice.isDefault && choice.info.name !== 'Default' && <span className="model-tag">Default</span>}
                          {(searching || tab === 'favorites') && <span className="model-of">{choice.provider.name}</span>}
                        </span>
                        {choice.info.description && <span className="model-desc">{choice.info.description}</span>}
                      </span>
                      {isCurrent(choice) && <Icon name="check" size={16} />}
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
                    {/* The reasoning levels belong to the model, so they are shown with it. */}
                    {isCurrent(choice) && <Reasoning model={choice.info} effort={bot.effort} set={(effort) => save({ effort })} />}
                  </Fragment>
                ))}
                {!searching && (folded.length > 0 || (more && inTab.some((c) => c.info.older))) && (
                  <button type="button" className="model-more" onClick={() => show(() => setMore(!more))}>{more ? 'Show fewer' : 'Show more'}</button>
                )}
                {!shown.length && (
                  <div className="model-empty">
                    {searching ? 'No model matches.'
                      : tab === 'favorites' ? 'Star a model to keep it here.'
                      : !viewed?.connected ? (
                        <>
                          <p>{viewed?.hint ?? `${viewed?.name} is not connected.`}</p>
                          <button type="button" onClick={() => (setOpen(false), openSettings('providers', tab))}>Open provider settings</button>
                        </>
                      )
                      : lists.has(tab) ? 'This provider lists no models.' : 'Loading models…'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <footer className="model-foot">
            <span className="model-foot-status">
              {viewed ? <><ProviderIcon provider={viewed} size={14} />{viewed.name} · {viewed.detail}</> : tab === 'favorites' ? 'Your starred models' : null}
            </span>
            <button type="button" className="ghost" onClick={() => (setOpen(false), openSettings('providers', ...(viewed ? [viewed.id] : [])))}><Icon name="sliders" size={14} /> Manage providers</button>
          </footer>
        </div>
      )}
    </div>
  )
}

/** The reasoning levels the bot's model takes, under it. Picking the one it uses by itself leaves the choice to the model. */
function Reasoning({ model, effort, set }: { model: ModelInfo; effort: Effort; set: (effort: Effort) => void }) {
  const levels = effortsOf(model)
  const usual = model.defaultEffort
  // With no level chosen the model uses its own; that is the one shown as picked, when it is known.
  const selected = effort || usual || ''
  if (!levels.length) return <p className="model-reasoning faint">This model has no reasoning setting.</p>
  const level = (value: Effort, label: string) => (
    <button key={value || 'auto'} type="button" role="radio" aria-checked={selected === value} className={selected === value ? 'active' : ''} onClick={() => selected !== value && set(value === usual ? '' : value)}>
      {label}
    </button>
  )
  return (
    // Like a row, a click here leaves typing in the search box.
    <div className="model-reasoning" onMouseDown={(e) => e.preventDefault()}>
      <span className="model-reasoning-head">Reasoning{usual ? ` · ${EFFORT_LABEL[usual]} by default` : ''}</span>
      <div className="segmented" role="radiogroup" aria-label="Reasoning">
        {!usual && level('', 'Auto')}
        {levels.map((value) => level(value, EFFORT_LABEL[value]))}
      </div>
    </div>
  )
}
