// What the bots' models used, in the conversation's place: how many tokens by provider, model and
// bot, what they would have cost as API calls, and how much of each plan is used up. The server
// counts (apps/server/src/usage.ts); what is fetched, added up and worded is shared with the phone
// (@openkumi/client/usage). This file draws it.
//
// The chart follows a few rules on purpose. Columns are stacked by provider, each provider in a
// colour of its own that never changes with its rank; segments are parted by a gap, not an
// outline; text is never in a provider's colour; and whatever hovering shows can be had without
// it, from the legend, the lists below, and the same numbers as a table.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useState } from 'react'
import type { ProviderLimits, Usage as Counted } from '@openkumi/shared'
import { moment } from '@openkumi/client/automations'
import {
  type Group, type Measure, RANGES, type Range, type Sum,
  botName, colorOf, columns, costOf, dollars, groupBy, lineLabel, modelLabel, pressure, providerName, scale, share, startsOver, stretch, tokens, total, unpricedNote, useUsage,
} from '@openkumi/client/usage'
import { Icon } from './Icon'
import { BotHead } from './Mascot'
import { usePrefs, appearance } from './prefs'
import { ProviderIcon } from './ProviderIcon'
import { Page } from './settingsUi'
import { useStore } from './store'

function savedRange(): Range {
  try {
    const kept = Number(localStorage.getItem('openkumi.usageRange'))
    return RANGES.some(([days]) => days === kept) ? (kept as Range) : 30
  } catch {
    return 30
  }
}

export function Usage({ openNav }: { openNav: () => void }) {
  const [range, setRange] = useState<Range>(savedRange)
  const { usage, limits, error, busy, refresh } = useUsage(range)
  const pick = (days: Range) => {
    setRange(days)
    try {
      localStorage.setItem('openkumi.usageRange', String(days))
    } catch {}
  }
  return (
    <div className="parts">
      <header>
        <button className="icon menu" aria-label="Menu" onClick={openNav}><Icon name="menu" size={18} /></button>
        <div className="heading"><span className="title">Usage</span></div>
        <div className="segmented" role="group" aria-label="Time shown">
          {RANGES.map(([days, label]) => (
            <button key={days} className={days === range ? 'active' : ''} aria-pressed={days === range} onClick={() => pick(days)}>{label}</button>
          ))}
        </div>
        <button className="icon" title="Look again" aria-label="Look again" disabled={busy} onClick={refresh}>
          {busy ? <span className="spinner" aria-hidden /> : <Icon name="reload" size={15} />}
        </button>
      </header>
      <div className="automations-body">
        <Page>
          {error && <div className="notice error" role="alert">{error}</div>}
          {usage ? <Counted usage={usage} limits={limits} range={range} stale={busy} /> : !error && <p className="set-intro">Adding it up…</p>}
        </Page>
      </div>
    </div>
  )
}

function Counted({ usage, limits, range, stale }: { usage: Counted; limits: ProviderLimits[] | null; range: Range; stale: boolean }) {
  const providers = useStore((s) => s.providers)
  const bots = useStore((s) => s.bots)
  const [measure, setMeasure] = useState<Measure>('tokens')
  const all = total(usage.rows)
  const byProvider = groupBy(usage.rows, (row) => row.provider)
  const byModel = groupBy(usage.rows, (row) => `${row.provider}\n${row.model}`)
  const byBot = groupBy(usage.rows, (row) => row.botId)
  const span = RANGES.find(([days]) => days === range)![1]
  const note = unpricedNote(usage.rows, usage.pricedAt)
  // The first thing counted is later than where the time shown begins: what came before is not known, not nothing.
  const partial = usage.since !== null && usage.since > (usage.step === 'hour' ? Date.parse(usage.starts[0]) : new Date(`${usage.starts[0]}T00:00:00`).getTime())

  return (
    // While newer numbers are fetched the old ones stay where they are, dimmed.
    <div className={`usage ${stale ? 'stale' : ''}`}>
      <p className="set-intro">
        What your bots’ models used on this OpenKumi. The cost is what the same tokens would have cost as API calls at list prices: a way to compare, not
        what your plans charge you.
        {usage.since === null ? ' Nothing has been counted yet: it starts with the next thing a bot does.' : partial && ` Counting began ${moment(usage.since)}; what was used before that is not known.`}
      </p>

      <div className="usage-tiles">
        <Tile label="Tokens" value={tokens(all.tokens)} detail={all.tokens ? `${tokens(all.input)} sent · ${tokens(all.output)} written` : `in the last ${span}`} />
        <Tile
          label="Cost as API calls"
          value={costOf(all)}
          detail={all.unpriced > 0 && all.cost > 0 ? `${tokens(all.unpriced)} tokens have no price` :all.unpriced > 0 ? 'no price for what was used' : 'at list prices'}
        />
        <Tile label="Read from cache" value={share(all.cached, all.input)} detail={all.input ? `${tokens(all.cached)} of ${tokens(all.input)} sent` : 'of what was sent'} />
      </div>

      <Limits limits={limits} />

      <section className="set-section">
        <div className="set-section-head">
          <h2>{usage.step === 'hour' ? 'By the hour' : 'By the day'}</h2>
          <div className="segmented" role="group" aria-label="What the chart measures">
            {(['tokens', 'cost'] as const).map((m) => (
              <button key={m} className={m === measure ? 'active' : ''} aria-pressed={m === measure} onClick={() => setMeasure(m)}>{m === 'tokens' ? 'Tokens' : 'Cost'}</button>
            ))}
          </div>
        </div>
        <div className="set-group usage-card">
          <Chart usage={usage} measure={measure} />
        </div>
      </section>

      {usage.rows.length > 0 && (
        <>
          <Breakdown
            title="Providers"
            groups={byProvider}
            whole={all}
            bar={(group) => colorOf(group.key, appearance())}
            lead={(group) => <span className="usage-mark"><span className="usage-swatch" style={{ background: colorOf(group.key, appearance()) }} /><ProviderIcon provider={providers.find((p) => p.id === group.key) ?? { id: group.key, detail: '' }} size={16} /></span>}
            name={(group) => providerName(group.key, providers)}
          />
          <Breakdown
            title="Models"
            groups={byModel}
            whole={all}
            name={(group) => modelLabel(group.key.split('\n')[1])}
            detail={(group) => providerName(group.key.split('\n')[0], providers)}
          />
          <Breakdown
            title="Bots"
            groups={byBot}
            whole={all}
            lead={(group) => {
              const bot = bots.find((b) => b.id === group.key)
              return bot ? <BotHead bot={bot} sign={false} /> : <span className="avatar">🤖</span>
            }}
            name={(group) => botName(group.key, bots)}
          />
        </>
      )}

      {(note || usage.pricedAt !== null) && (
        <p className="set-intro usage-foot">
          {note}
          {note && usage.pricedAt !== null && ' '}
          {usage.pricedAt !== null && `Claude Code prices its own turns; everything else is priced from LiteLLM’s public list of model prices, fetched ${moment(usage.pricedAt)}.`}
        </p>
      )}
    </div>
  )
}

/** One headline number: what it is, the number, and a line about it. */
function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="usage-tile">
      <span className="usage-tile-label">{label}</span>
      <span className="usage-tile-value">{value}</span>
      <span className="usage-tile-detail">{detail}</span>
    </div>
  )
}

// ---- how much of each plan is used

function Limits({ limits }: { limits: ProviderLimits[] | null }) {
  const providers = useStore((s) => s.providers)
  // Nothing to show where no provider has a plan that can be asked about (only local models, say).
  if (limits && !limits.length) return null
  return (
    <section className="set-section">
      <div className="set-section-head"><h2>Plan limits</h2></div>
      <div className="set-group">
        {!limits && <div className="set-row usage-limit"><p className="usage-quiet"><span className="spinner" aria-hidden /> Asking Claude Code and Codex how much of your plans is used…</p></div>}
        {limits?.map((plan) => {
          const provider = providers.find((p) => p.id === plan.provider) ?? { id: plan.provider, detail: '' }
          return (
            <div key={plan.provider} className="set-row usage-limit">
              <h3>
                <ProviderIcon provider={provider} size={16} />
                {providerName(plan.provider, providers)}
                {plan.plan && <span className="usage-plan">{plan.plan}</span>}
              </h3>
              {plan.note && <p>{plan.note}</p>}
              {plan.limits.map((limit) => {
                const state = pressure(limit.used)
                return (
                  <div key={limit.label} className={`usage-meter ${state}`}>
                    <span className="usage-meter-name">{limit.label}</span>
                    <span className="usage-track" role="meter" aria-label={`${limit.label}, used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(limit.used)}>
                      <span style={{ width: `${limit.used}%` }} />
                    </span>
                    <strong className="usage-meter-figure">{state !== 'fine' && <Icon name="info" size={13} />}{Math.round(limit.used)}% used</strong>
                    <span className="usage-meter-reset">{[state === 'full' ? 'As good as used up' : state === 'high' ? 'Nearly used up' : '', startsOver(limit.resetsAt)].filter(Boolean).join(' · ')}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---- the chart: a column for each day or hour, stacked by provider

function Chart({ usage, measure }: { usage: Counted; measure: Measure }) {
  // Redrawn when the appearance changes, as the colours are picked for each.
  usePrefs()
  const providers = useStore((s) => s.providers)
  const [pointed, setAt] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const { series, values, most } = columns(usage, measure)
  const lines = scale(most)
  const top = lines.at(-1)!
  const say = (n: number) => (measure === 'tokens' ? tokens(n) : dollars(n))
  const count = usage.starts.length
  // The column pointed at. One from a longer stretch of time, still pointed at when a shorter one arrives, is not in this chart.
  const at = pointed !== null && pointed < count ? pointed : null
  // A few dates under the columns, spread evenly: every one would not fit.
  const every = count <= 8 ? 1 : Math.ceil(count / 6)
  const labelled = (i: number) => (count - 1 - i) % every === 0
  const sums = values.map((column) => column.reduce((a, b) => a + b, 0))

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    setAt(Math.min(count - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * count))))
  }
  // With the keyboard, the arrows walk along the columns.
  const walk = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    e.preventDefault()
    setAt((was) => Math.min(count - 1, Math.max(0, (was ?? count - 1) + step)))
  }

  if (!most) return <p className="usage-quiet usage-empty">{measure === 'cost' && usage.rows.length ? 'Nothing that was used in this time has a price.' : 'Nothing was used in this time.'}</p>

  return (
    <div className="usage-chart">
      <div className="usage-legend">
        {series.map((provider) => (
          <span key={provider}><span className="usage-swatch" style={{ background: colorOf(provider, appearance()) }} />{providerName(provider, providers)}</span>
        ))}
        <button className="usage-as-table" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}><Icon name={asTable ? 'steps' : 'table'} size={13} /> {asTable ? 'Show the chart' : 'Show as a table'}</button>
      </div>
      {asTable ? (
        <table className="usage-table">
          <thead>
            <tr><th scope="col">{usage.step === 'hour' ? 'Hour' : 'Day'}</th>{series.map((provider) => <th key={provider} scope="col">{providerName(provider, providers)}</th>)}<th scope="col">Total</th></tr>
          </thead>
          <tbody>
            {usage.starts.map((start, i) => ({ start, i })).reverse().filter(({ i }) => sums[i] > 0).map(({ start, i }) => (
              <tr key={start}><th scope="row">{stretch(start, usage.step, true)}</th>{values[i].map((value, s) => <td key={series[s]}>{value ? say(value) : '–'}</td>)}<td>{say(sums[i])}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="usage-plot-row">
          <div className="usage-axis" aria-hidden>{[...lines].reverse().map((line) => <span key={line}>{lineLabel(line, measure)}</span>)}</div>
          <div
            className="usage-plot"
            style={{ '--columns': count } as CSSProperties}
            tabIndex={0}
            role="img"
            aria-label={`${measure === 'tokens' ? 'Tokens' : 'Cost as API calls'} for each ${usage.step}, by provider. ${at === null ? 'Use the arrow keys to read each one.' : `${stretch(usage.starts[at], usage.step, true)}: ${say(sums[at])}.`}`}
            onPointerMove={point}
            onPointerLeave={() => setAt(null)}
            onKeyDown={walk}
            onBlur={() => setAt(null)}
          >
            <div className="usage-grid" aria-hidden>{lines.map((line) => <span key={line} style={{ bottom: `${(line / top) * 100}%` }} />)}</div>
            <div className="usage-columns" aria-hidden>
              {values.map((column, i) => (
                <div key={usage.starts[i]} className={`usage-column ${at === i ? 'on' : ''}`}>
                  <div className="usage-stack" style={{ height: `${(sums[i] / top) * 100}%` }}>
                    {column.map((value, s) => value > 0 && <span key={series[s]} style={{ flexGrow: value, background: colorOf(series[s], appearance()) }} />)}
                  </div>
                  {labelled(i) && <span className={`usage-date ${i === 0 ? 'first' : i === count - 1 ? 'last' : ''}`}>{stretch(usage.starts[i], usage.step)}</span>}
                </div>
              ))}
            </div>
            {at !== null && (
              <div className={`usage-tip ${at < count / 2 ? 'right' : 'left'}`} style={{ left: `${((at + 0.5) / count) * 100}%` }} aria-hidden>
                <strong>{stretch(usage.starts[at], usage.step, true)}</strong>
                {series.map((provider, s) => values[at][s] > 0 && (
                  <span key={provider}><i style={{ background: colorOf(provider, appearance()) }} /><b>{say(values[at][s])}</b>{providerName(provider, providers)}</span>
                ))}
                {series.filter((_, s) => values[at][s] > 0).length !== 1 && <span className="sum"><i /><b>{say(sums[at])}</b>{sums[at] ? 'Total' : 'Nothing used'}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- who used it: a list, the most first, each with a thin bar for its share

function Breakdown({ title, groups, whole, lead, name, detail, bar }: {
  title: string
  groups: Group[]
  whole: Sum
  lead?: (group: Group) => ReactNode
  name: (group: Group) => string
  detail?: (group: Group) => string
  /** The colour of a row's bar, where rows have colours of their own; otherwise all are the same grey. */
  bar?: (group: Group) => string
}) {
  const most = Math.max(...groups.map((group) => group.tokens))
  return (
    <section className="set-section">
      <div className="set-section-head"><h2>{title}</h2></div>
      <div className="set-group usage-list" role="table" aria-label={title}>
        <div className="usage-list-head" role="row">
          <span role="columnheader">{title.replace(/s$/, '')}</span>
          <span role="columnheader">Tokens</span>
          <span role="columnheader">Share</span>
          <span role="columnheader">Cost</span>
        </div>
        {groups.map((group) => (
          <div key={group.key} className="usage-list-row" role="row">
            <span className="usage-who" role="cell">
              {lead?.(group)}
              <span className="usage-name">
                <span title={name(group)}>{name(group)}</span>
                <small>{[detail?.(group), `${tokens(group.input)} sent, ${share(group.cached, group.input)} from cache · ${tokens(group.output)} written`].filter(Boolean).join(' · ')}</small>
              </span>
            </span>
            <span role="cell">{tokens(group.tokens)}</span>
            <span role="cell">{share(group.tokens, whole.tokens)}</span>
            <span role="cell" title={group.unpriced > 0 && group.cost > 0 ? `Not counting ${tokens(group.unpriced)} tokens with no price` : undefined}>{costOf(group)}{group.unpriced > 0 && group.cost > 0 ? '+' : ''}</span>
            <span className="usage-bar" aria-hidden><span style={{ width: `${(group.tokens / most) * 100}%`, background: bar?.(group) }} /></span>
          </div>
        ))}
      </div>
    </section>
  )
}
