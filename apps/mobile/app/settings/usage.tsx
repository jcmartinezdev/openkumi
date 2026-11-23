// What the bots' models used, on the phone: how many tokens by provider, model and bot, what they
// would have cost as API calls, and how much of each plan is used up. The same numbers as the
// computer's Usage page (apps/web/src/Usage.tsx): the server counts them, and what is fetched,
// added up and worded is shared (@openkumi/client/usage). This file draws it for a narrow screen.
//
// The chart keeps to the same rules as the computer's: a colour belongs to a provider and never
// to its rank, parts of a column are divided by a gap and not an outline, text is never in a
// provider's colour, and what touching a column shows is also there as a list.
import { type ReactNode, useEffect, useState } from 'react'
import { type GestureResponderEvent, StyleSheet, Text, View } from 'react-native'
import type { ProviderLimits, Usage as Counted, UsageLimit } from '@openkumi/shared'
import { moment } from '@openkumi/client/automations'
import { useStore } from '@openkumi/client/store'
import {
  type Group, type Measure, RANGES, type Range, type Sum,
  botName, colorOf, columns, costOf, dollars, groupBy, lineLabel, modelLabel, pressure, providerName, scale, share, startsOver, stretch, tokens, total, unpricedNote, useUsage,
} from '@openkumi/client/usage'
import { Glyph, ProviderIcon } from '../../src/icons'
import { useSession } from '../../src/session'
import { Avatar, Note, Row, Section, Segments, SettingsPage } from '../../src/SettingsUi'
import { useAppearance, useTheme } from '../../src/theme'

/** The time last looked at, for as long as the app runs. */
let remembered: Range = 30

export default function UsageScreen() {
  const { server } = useSession()
  const [range, setRange] = useState<Range>(remembered)
  const { usage, limits, error, busy, refresh } = useUsage(range)
  // The page fetches again by itself when a bot has finished; only a pull shows the spinner.
  const [pulled, setPulled] = useState(false)
  useEffect(() => {
    if (!busy) setPulled(false)
  }, [busy])
  const name = server?.name ?? 'the server'

  return (
    <SettingsPage title="Usage" subtitle={server?.name} refresh={{ busy: pulled && busy, run: () => (setPulled(true), refresh()) }}>
      <Segments
        label="Time shown"
        value={String(range)}
        options={RANGES.map(([days, label]) => [String(days), label] as const)}
        onChange={(days) => setRange((remembered = Number(days) as Range))}
      />
      {!!error && <Note tone="error">{error}</Note>}
      {usage ? <Shown usage={usage} limits={limits} name={name} stale={busy} /> : !error && <Note>Adding it up…</Note>}
    </SettingsPage>
  )
}

function Shown({ usage, limits, name, stale }: { usage: Counted; limits: ProviderLimits[] | null; name: string; stale: boolean }) {
  const theme = useTheme()
  const appearance = useAppearance()
  const providers = useStore((s) => s.providers)
  const bots = useStore((s) => s.bots)
  const [measure, setMeasure] = useState<Measure>('tokens')
  const all = total(usage.rows)
  const byProvider = groupBy(usage.rows, (row) => row.provider)
  const byModel = groupBy(usage.rows, (row) => `${row.provider}\n${row.model}`)
  const byBot = groupBy(usage.rows, (row) => row.botId)
  const note = unpricedNote(usage.rows, usage.pricedAt)
  // The first thing counted is later than where the time shown begins: what came before is not known, not nothing.
  const partial = usage.since !== null && usage.since > (usage.step === 'hour' ? Date.parse(usage.starts[0]) : new Date(`${usage.starts[0]}T00:00:00`).getTime())
  const most = (groups: Group[]) => Math.max(1, ...groups.map((group) => group.tokens))

  return (
    // While newer numbers are fetched the old ones stay where they are, dimmed.
    <View style={[styles.shown, stale && { opacity: 0.6 }]}>
      <Section
        bare
        footer={
          `What your bots’ models used on ${name}. The cost is what the same tokens would have cost as API calls at list prices: a way to compare, not what your plans charge you.` +
          (usage.since === null ? ' Nothing has been counted yet: it starts with the next thing a bot does.' : partial ? ` Counting began ${moment(usage.since)}; what was used before that is not known.` : '')
        }
      >
        <View style={[styles.card, styles.tiles, { backgroundColor: theme.groupCard }]}>
          <Tile label="Tokens" value={tokens(all.tokens)} detail={all.input ? `${share(all.cached, all.input)} of what was sent came from cache` : 'sent and written'} />
          <View style={[styles.rule, { backgroundColor: theme.border }]} />
          <Tile
            label="Cost as API calls"
            value={costOf(all)}
            detail={all.unpriced > 0 && all.cost > 0 ? `${tokens(all.unpriced)} tokens have no price` : all.unpriced > 0 ? 'no price for what was used' : 'at list prices'}
          />
        </View>
      </Section>

      <Limits limits={limits} />

      <Section title={usage.step === 'hour' ? 'By the hour' : 'By the day'} bare>
        <Segments label="What the chart measures" value={measure} options={[['tokens', 'Tokens'], ['cost', 'Cost']] as const} onChange={setMeasure} />
        <Chart usage={usage} measure={measure} />
      </Section>

      {usage.rows.length > 0 && (
        <>
          <Section title="Providers">
            {byProvider.map((group) => (
              <Line
                key={group.key}
                leading={
                  <View style={styles.mark}>
                    <View style={[styles.swatch, { backgroundColor: colorOf(group.key, appearance) }]} />
                    <ProviderIcon provider={providers.find((p) => p.id === group.key) ?? { id: group.key, detail: '' }} size={20} color={theme.text} />
                  </View>
                }
                name={providerName(group.key, providers)}
                group={group}
                whole={all}
                most={most(byProvider)}
                color={colorOf(group.key, appearance)}
              />
            ))}
          </Section>
          <Section title="Models">
            {byModel.map((group) => (
              <Line key={group.key} name={modelLabel(group.key.split('\n')[1])} detail={providerName(group.key.split('\n')[0], providers)} group={group} whole={all} most={most(byModel)} />
            ))}
          </Section>
          <Section title="Bots" footer={[note, usage.pricedAt !== null && `Claude Code prices its own turns; everything else is priced from LiteLLM’s public list of model prices, fetched ${moment(usage.pricedAt)}.`].filter(Boolean).join(' ') || undefined}>
            {byBot.map((group) => (
              <Line key={group.key} leading={<Avatar bot={bots.find((b) => b.id === group.key)} size={30} />} name={botName(group.key, bots)} group={group} whole={all} most={most(byBot)} />
            ))}
          </Section>
        </>
      )}
    </View>
  )
}

/** One headline number: what it is, the number, and a line about it. */
function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  const theme = useTheme()
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}, ${detail}`}>
      <Text style={[styles.tileLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
      <Text style={[styles.tileDetail, { color: theme.faint }]}>{detail}</Text>
    </View>
  )
}

// ---- how much of each plan is used

function Limits({ limits }: { limits: ProviderLimits[] | null }) {
  const theme = useTheme()
  const providers = useStore((s) => s.providers)
  // Nothing to show where no provider has a plan that can be asked about (only local models, say).
  if (limits && !limits.length) return null
  return (
    <Section title="Plan limits">
      {!limits && <Text style={[styles.quiet, { color: theme.muted }]}>Asking Claude Code and Codex how much of your plans is used…</Text>}
      {limits?.map((plan) => (
        <View key={plan.provider} style={styles.plan}>
          <View style={styles.planHead}>
            <ProviderIcon provider={providers.find((p) => p.id === plan.provider) ?? { id: plan.provider, detail: '' }} size={20} color={theme.text} />
            <Text style={[styles.planName, { color: theme.text }]}>{providerName(plan.provider, providers)}</Text>
            {!!plan.plan && <Text style={[styles.planKind, { color: theme.muted }]}>{plan.plan}</Text>}
          </View>
          {!!plan.note && <Text style={[styles.planNote, { color: theme.muted }]}>{plan.note}</Text>}
          {plan.limits.map((limit) => <Meter key={limit.label} limit={limit} />)}
        </View>
      ))}
    </Section>
  )
}

/** One allowance: its name and how much is used, a bar filled that far, and when it starts over. */
function Meter({ limit }: { limit: UsageLimit }) {
  const theme = useTheme()
  const state = pressure(limit.used)
  // The bar wears the colour of how full it is, on a paler step of the same colour; the words beside it say the same.
  const color = state === 'full' ? theme.err : state === 'high' ? theme.run : theme.text
  const under = [state === 'full' ? 'As good as used up' : state === 'high' ? 'Nearly used up' : '', startsOver(limit.resetsAt)].filter(Boolean).join(' · ')
  const used = `${Math.round(limit.used)}% used`
  return (
    <View style={styles.meter} accessible accessibilityRole="progressbar" accessibilityLabel={`${limit.label}: ${used}. ${under}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(limit.used) }}>
      <View style={styles.meterHead}>
        <Text style={[styles.meterName, { color: theme.text }]}>{limit.label}</Text>
        {state !== 'fine' && <Glyph name="warn" size={15} color={color} weight={1.9} />}
        <Text style={[styles.meterFigure, { color: theme.text }]}>{used}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: `${color}29` }]}>
        <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, limit.used))}%`, backgroundColor: color }]} />
      </View>
      {!!under && <Text style={[styles.meterUnder, { color: theme.faint }]}>{under}</Text>}
    </View>
  )
}

// ---- the chart: a column for each day or hour, stacked by provider

const PLOT = 150

function Chart({ usage, measure }: { usage: Counted; measure: Measure }) {
  const theme = useTheme()
  const appearance = useAppearance()
  const providers = useStore((s) => s.providers)
  const [at, setAt] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  const [listed, setListed] = useState(false)
  const { series, values, most } = columns(usage, measure)
  const say = (n: number) => (measure === 'tokens' ? tokens(n) : dollars(n))
  const count = usage.starts.length
  // Another time or measure is another chart: what was picked in the last one is not in it.
  useEffect(() => setAt(null), [usage.starts[0], count, measure])

  if (!most) {
    return (
      <View style={[styles.card, styles.chart, { backgroundColor: theme.groupCard }]}>
        <Text style={[styles.quiet, styles.empty, { color: theme.muted }]}>{measure === 'cost' && usage.rows.length ? 'Nothing that was used in this time has a price.' : 'Nothing was used in this time.'}</Text>
      </View>
    )
  }

  const lines = scale(most)
  const top = lines.at(-1)!
  const sums = values.map((column) => column.reduce((a, b) => a + b, 0))
  const slot = width / count
  // Thin columns with the card showing between them; on a long stretch of time they get very thin, and so do the gaps.
  const thick = Math.max(1, Math.min(24, slot - (slot >= 6 ? 2 : 1)))
  const gap = slot >= 6 ? 2 : 1
  // A few dates under the columns: every one where they fit, else four spread evenly.
  const dated = count <= 7 ? usage.starts.map((_, i) => i) : [0, Math.round((count - 1) / 3), Math.round(((count - 1) * 2) / 3), count - 1]
  const picked = at !== null && at < count ? at : null

  // Touching a column, or sliding along them, reads it out above; touching it again lets go of it.
  const pick = (e: GestureResponderEvent, began: boolean) => {
    if (!width) return
    const i = Math.min(count - 1, Math.max(0, Math.floor((e.nativeEvent.locationX / width) * count)))
    setAt((was) => (began && was === i ? null : i))
  }
  const days = usage.starts.map((start, i) => ({ start, i })).reverse().filter(({ i }) => sums[i] > 0)

  return (
    <View style={[styles.card, { backgroundColor: theme.groupCard }]}>
      <View style={styles.chart}>
        {/* The names of the colours; with a column picked, what it holds, in the same place. */}
        <View style={styles.readout}>
          {picked === null ? (
            <>
              <View style={styles.keys}>
                {series.map((provider) => <Key key={provider} color={colorOf(provider, appearance)} text={providerName(provider, providers)} />)}
              </View>
              <Text style={[styles.hint, { color: theme.faint }]}>Touch a column to read it.</Text>
            </>
          ) : (
            <>
              <Text style={[styles.pickedHead, { color: theme.text }]}>{stretch(usage.starts[picked], usage.step, true)} · {sums[picked] ? say(sums[picked]) : 'nothing used'}</Text>
              <View style={styles.keys}>
                {series.map((provider, s) => values[picked][s] > 0 && <Key key={provider} color={colorOf(provider, appearance)} strong={say(values[picked][s])} text={providerName(provider, providers)} />)}
              </View>
            </>
          )}
        </View>

        <View style={styles.plotRow}>
          <View style={styles.axis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[...lines].reverse().map((line) => <Text key={line} style={[styles.axisText, { color: theme.faint }]}>{lineLabel(line, measure)}</Text>)}
          </View>
          <View style={styles.plotColumn}>
            <View
              style={styles.plot}
              onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${measure === 'tokens' ? 'Tokens' : 'Cost as API calls'} for each ${usage.step}, by provider. The most in one ${usage.step}: ${say(most)}. The list below has each one.`}
            >
              {lines.map((line) => <View key={line} style={[styles.gridLine, { bottom: `${(line / top) * 100}%`, backgroundColor: theme.border }]} />)}
              <View style={styles.columns}>
                {values.map((column, i) => (
                  <View key={usage.starts[i]} style={[styles.column, picked === i && { backgroundColor: theme.bubble }]}>
                    <View style={[styles.stack, { width: thick, height: `${(sums[i] / top) * 100}%`, minHeight: sums[i] > 0 ? 2 : 0, gap, borderTopLeftRadius: Math.min(4, thick / 2), borderTopRightRadius: Math.min(4, thick / 2) }]}>
                      {column.map((value, s) => value > 0 && <View key={series[s]} style={{ flexGrow: value, flexBasis: 0, backgroundColor: colorOf(series[s], appearance) }} />)}
                    </View>
                  </View>
                ))}
              </View>
              {/* What is touched is this sheet over the columns, so a touch is measured from the chart's own edge. */}
              <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onResponderGrant={(e) => pick(e, true)} onResponderMove={(e) => pick(e, false)} />
            </View>
            <View style={styles.dates} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {dated.map((i) => <Text key={i} style={[styles.axisText, count <= 7 && styles.dateEach, { color: theme.faint }]}>{stretch(usage.starts[i], usage.step)}</Text>)}
            </View>
          </View>
        </View>
      </View>

      {/* The same numbers as a list, for reading them without touching the chart. */}
      <View style={[styles.hair, { backgroundColor: theme.border }]} />
      <Row label={listed ? 'Hide the list' : usage.step === 'hour' ? 'Show each hour' : 'Show each day'} tone="action" onPress={() => setListed(!listed)} />
      {listed && days.map(({ start, i }) => (
        <View key={start}>
          <View style={[styles.hair, { marginLeft: 16, backgroundColor: theme.border }]} />
          <Row label={stretch(start, usage.step, true)} detail={series.flatMap((provider, s) => (values[i][s] > 0 ? [`${providerName(provider, providers)} ${say(values[i][s])}`] : [])).join(' · ')} value={say(sums[i])} />
        </View>
      ))}
    </View>
  )
}

/** A colour and whose it is, with what it stands for in front when there is a figure. */
function Key({ color, text, strong }: { color: string; text: string; strong?: string }) {
  const theme = useTheme()
  return (
    <View style={styles.key}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      {!!strong && <Text style={[styles.keyText, styles.keyStrong, { color: theme.text }]}>{strong}</Text>}
      <Text style={[styles.keyText, { color: theme.muted }]}>{text}</Text>
    </View>
  )
}

// ---- who used it: a row each, the most first, with a thin bar for its share of the tokens

function Line({ leading, name, detail, group, whole, most, color }: { leading?: ReactNode; name: string; detail?: string; group: Group; whole: Sum; most: number; color?: string }) {
  const theme = useTheme()
  const cost = `${costOf(group)}${group.unpriced > 0 && group.cost > 0 ? '+' : ''}`
  const made = `${tokens(group.input)} sent, ${share(group.cached, group.input)} from cache · ${tokens(group.output)} written`
  return (
    <View
      style={styles.line}
      accessible
      accessibilityLabel={`${name}${detail ? `, ${detail}` : ''}: ${tokens(group.tokens)} tokens, ${share(group.tokens, whole.tokens)} of all. ${group.unpriced > 0 && group.cost === 0 ? 'No price' : `Cost as API calls ${dollars(group.cost)}`}. ${made}.`}
    >
      <View style={styles.lineMain}>
        {leading}
        <View style={styles.lineText}>
          <Text style={[styles.lineName, { color: theme.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.lineDetail, { color: theme.faint }]}>{detail ? `${detail}\n${made}` : made}</Text>
        </View>
        <View style={styles.lineFigures}>
          <Text style={[styles.lineTokens, { color: theme.text }]}>{tokens(group.tokens)}</Text>
          <Text style={[styles.lineCost, { color: theme.muted }]}>{cost}</Text>
        </View>
      </View>
      <View style={[styles.bar, { backgroundColor: theme.bubble }]}>
        <View style={[styles.barFill, { width: `${(group.tokens / most) * 100}%`, backgroundColor: color ?? theme.faint }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shown: { gap: 26 },
  card: { borderRadius: 16, overflow: 'hidden' },
  hair: { height: StyleSheet.hairlineWidth },
  quiet: { fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingVertical: 14 },
  empty: { textAlign: 'center', paddingVertical: 34 },

  tiles: { flexDirection: 'row' },
  tile: { flex: 1, gap: 3, paddingHorizontal: 16, paddingVertical: 14 },
  rule: { width: StyleSheet.hairlineWidth, marginVertical: 14 },
  tileLabel: { fontSize: 13 },
  tileValue: { fontSize: 28, fontWeight: '600', letterSpacing: -0.3 },
  tileDetail: { fontSize: 12.5, lineHeight: 17 },

  plan: { gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  planName: { fontSize: 16.5, fontWeight: '500' },
  planKind: { fontSize: 13.5 },
  planNote: { fontSize: 13.5, lineHeight: 18 },
  meter: { gap: 6 },
  meterHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meterName: { flex: 1, fontSize: 14.5 },
  meterFigure: { fontSize: 14.5, fontWeight: '500', fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4 },
  fill: { height: 8, minWidth: 3, borderRadius: 4 },
  meterUnder: { fontSize: 12.5 },

  chart: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  readout: { minHeight: 46, gap: 5, marginBottom: 10 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  keyText: { fontSize: 12.5 },
  keyStrong: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12.5 },
  pickedHead: { fontSize: 14, fontWeight: '600' },
  plotRow: { flexDirection: 'row', gap: 8 },
  // Each figure sits on its line: the first and last reach half their height past the ends.
  axis: { height: PLOT + 12, marginTop: -6, justifyContent: 'space-between', alignItems: 'flex-end' },
  axisText: { fontSize: 11, lineHeight: 12, fontVariant: ['tabular-nums'] },
  plotColumn: { flex: 1 },
  plot: { height: PLOT },
  gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  columns: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  stack: { flexDirection: 'column-reverse', overflow: 'hidden' },
  dates: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  dateEach: { flex: 1, textAlign: 'center' },

  mark: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  line: { gap: 9, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 13 },
  lineMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineText: { flex: 1, gap: 2 },
  lineName: { fontSize: 16, fontWeight: '500' },
  lineDetail: { fontSize: 12.5, lineHeight: 17 },
  lineFigures: { alignItems: 'flex-end', gap: 2 },
  lineTokens: { fontSize: 16, fontVariant: ['tabular-nums'] },
  lineCost: { fontSize: 13.5, fontVariant: ['tabular-nums'] },
  bar: { height: 4, borderRadius: 2 },
  barFill: { height: 4, minWidth: 3, borderRadius: 2 },
})
