// Choosing what a bot runs on: the phone's version of the computer's model picker, opened from the
// composer as a sheet. The providers are along the top and the models of the one picked are below
// them, each with what it is for; the bot's own model opens up to show its reasoning levels. Typing
// searches the models of every provider, and picking a model of another provider moves the bot to
// that provider. Each choice is saved at once and the sheet stays open, so a model and its
// reasoning can be picked in one go.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, type LayoutChangeEvent, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import type { Bot, Effort, ModelInfo } from '@openbot/shared'
import { type Choice, EFFORT_LABEL, choicesOf, effortsOf, loadModels, switchTo, useModelLists } from '@openbot/client/models'
import { api, useStore } from '@openbot/client/store'
import { toggleFavorite, useFavorites } from '../../src/favorites'
import { Glyph, ProviderIcon } from '../../src/icons'
import { type Theme, useTheme } from '../../src/theme'

export default function ModelSheet() {
  const theme = useTheme()
  const router = useRouter()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const stored = useStore((s) => s.bots.find((b) => b.id === botId))
  // Providers that are switched off in Settings are not offered at all.
  const providers = useStore((s) => s.providers).filter((p) => p.enabled !== false)
  const favorites = useFavorites()
  /** What was just picked, shown at once instead of when the server has said so. */
  const [picked, setPicked] = useState<Partial<Bot> | null>(null)
  const [tab, setTab] = useState(() => (providers.some((p) => p.id === stored?.provider) ? stored!.provider : (providers[0]?.id ?? '')))
  const [query, setQuery] = useState('')
  const [more, setMore] = useState(false)
  const tabs = useRef<ScrollViewInstance>(null)
  /** The row of providers opens scrolled to the bot's own, once. */
  const reveal = useRef(true)

  const ready = providers.filter((p) => p.connected)
  const lists = useModelLists(ready.map((p) => p.id))
  useEffect(() => {
    // Asked for afresh: a model may have been added since.
    for (const p of ready) void loadModels(p.id, true)
  }, [])
  // The server's word replaces what was shown in the meantime.
  useEffect(() => setPicked(null), [stored])

  if (!stored) return null
  const bot = { ...stored, ...picked }
  const all = ready.flatMap((p) => choicesOf(p, lists.get(p.id) ?? [], bot))
  const isCurrent = (c: Choice) => c.provider.id === bot.provider && c.model === bot.model
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const inTab = all.filter((c) => (tab === 'favorites' ? favorites.includes(c.key) : c.provider.id === tab))
  // Earlier models stay folded away until asked for, except the one the bot is on.
  const folded = tab === 'favorites' || more ? [] : inTab.filter((c) => c.info.older && !isCurrent(c))
  const shown = searching ? all.filter((c) => words.every((word) => `${c.info.name} ${c.info.id} ${c.provider.name}`.toLowerCase().includes(word))) : inTab.filter((c) => !folded.includes(c))
  const provider = providers.find((p) => p.id === tab)

  const save = (patch: Partial<Bot>) => {
    setPicked((before) => ({ ...before, ...patch }))
    api('PATCH', `/api/bots/${bot.id}`, patch).catch((e) => (setPicked(null), Alert.alert('Not saved', (e as Error).message)))
  }
  const choose = (choice: Choice) => {
    if (isCurrent(choice)) return
    void Haptics.selectionAsync()
    save(switchTo(bot, choice))
  }
  const show = (next: string) => (setTab(next), setQuery(''), setMore(false))

  // The sheet sizes its content as a header and one scroll view under it, as react-native-screens
  // expects of a form sheet: the list is then as tall as the sheet is open, at either height.
  return (
    <>
      <View collapsable={false} style={styles.top}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Model</Text>
          <Pressable accessibilityRole="button" hitSlop={12} style={styles.done} onPress={() => router.back()}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </View>

        <View style={[styles.search, { backgroundColor: theme.bubble }]}>
          <Glyph name="search" size={16} color={theme.faint} />
          <TextInput
            accessibilityLabel="Search models"
            style={[styles.searchInput, { color: theme.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search models"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>

        <ScrollView ref={tabs} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
          {(favorites.length > 0 || tab === 'favorites') && (
            <Tab label="Favorites" selected={tab === 'favorites' && !searching} theme={theme} onPress={() => show('favorites')}>
              <Glyph name="star" size={14} filled color={tab === 'favorites' && !searching ? theme.onPrimary : theme.run} />
            </Tab>
          )}
          {providers.map((p) => (
            <Tab
            key={p.id}
            label={p.name}
            selected={tab === p.id && !searching}
            off={!p.connected}
            theme={theme}
            onPress={() => show(p.id)}
            onLayout={tab === p.id && reveal.current ? (e) => ((reveal.current = false), tabs.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 16), animated: false })) : undefined}
          >
              <ProviderIcon provider={p} size={15} color={tab === p.id && !searching ? theme.onPrimary : theme.text} />
            </Tab>
          ))}
        </ScrollView>
        {!searching && <Text style={[styles.caption, { color: theme.faint }]} numberOfLines={1}>{tab === 'favorites' ? 'Your starred models, from every provider' : provider?.detail}</Text>}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {shown.map((choice) => (
          <View key={choice.key}>
            <Row choice={choice} current={isCurrent(choice)} favorite={favorites.includes(choice.key)} named={searching || tab === 'favorites'} theme={theme} onPress={() => choose(choice)} />
            {/* The reasoning levels belong to the model, so they are shown with it. Not inside the row's button, which would stop them being pressed on their own. */}
            {isCurrent(choice) && <Reasoning model={choice.info} effort={bot.effort} theme={theme} set={(effort) => (void Haptics.selectionAsync(), save({ effort }))} />}
          </View>
        ))}
        {!searching && (folded.length > 0 || (more && inTab.some((c) => c.info.older))) && (
          <Pressable accessibilityRole="button" style={styles.more} onPress={() => setMore(!more)}>
            <Text style={{ color: theme.muted, fontSize: 14 }}>{more ? 'Show fewer' : `Show ${folded.length} earlier ${folded.length === 1 ? 'model' : 'models'}`}</Text>
          </Pressable>
        )}
        {!shown.length && (
          <View style={styles.empty}>
            {searching ? <Text style={[styles.emptyText, { color: theme.muted }]}>No model matches.</Text>
              : tab === 'favorites' ? <Text style={[styles.emptyText, { color: theme.muted }]}>Tap the star next to a model to keep it here.</Text>
              : !provider?.connected ? (
                <>
                  <Text style={[styles.emptyText, { color: theme.text }]}>{provider ? (provider.hint ?? `${provider.name} is not connected.`) : 'There is nothing to run bots on yet.'}</Text>
                  <Text style={[styles.emptyText, { color: theme.faint }]}>Connect it in Open Bot on your computer, in Settings › Providers.</Text>
                </>
              )
              : lists.has(tab) ? <Text style={[styles.emptyText, { color: theme.muted }]}>This provider lists no models.</Text>
              : <ActivityIndicator color={theme.muted} />}
          </View>
        )}
      </ScrollView>
    </>
  )
}

function Tab({ label, selected, off, theme, onPress, onLayout, children }: { label: string; selected: boolean; off?: boolean; theme: Theme; onPress: () => void; onLayout?: (e: LayoutChangeEvent) => void; children: ReactNode }) {
  return (
    <Pressable
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={off ? `${label}, not connected` : label}
      style={[styles.tab, { backgroundColor: selected ? theme.primary : theme.bubble, opacity: off && !selected ? 0.5 : 1 }]}
      onPress={onPress}
    >
      {children}
      <Text style={{ color: selected ? theme.onPrimary : theme.text, fontSize: 14, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  )
}

/** A model: its name and what it is for, a check when it is the bot's, and a star to keep it at hand. */
function Row({ choice, current, favorite, named, theme, onPress }: { choice: Choice; current: boolean; favorite: boolean; named: boolean; theme: Theme; onPress: () => void }) {
  // Away from its provider's own list, a model says whose it is.
  const detail = [named && choice.provider.name, choice.info.description].filter(Boolean).join(' · ')
  // The star is a button beside the row's, not in it, so VoiceOver can reach each on its own.
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: current }} style={({ pressed }) => [styles.pick, pressed && { backgroundColor: theme.bubble }]} onPress={onPress}>
        <ProviderIcon provider={choice.provider} size={20} color={theme.text} />
        <View style={styles.rowText}>
          <View style={styles.nameLine}>
            <Text style={[styles.name, { color: theme.text, fontWeight: current ? '600' : '400' }]} numberOfLines={1}>{choice.info.name}</Text>
            {choice.isDefault && choice.info.name !== 'Default' && <Text style={[styles.tag, { color: theme.muted, borderColor: theme.border }]}>Default</Text>}
          </View>
          {!!detail && <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 17 }} numberOfLines={2}>{detail}</Text>}
        </View>
        {current && <Glyph name="check" size={18} color={theme.text} weight={2.2} />}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={favorite ? `Remove ${choice.info.name} from favorites` : `Add ${choice.info.name} to favorites`}
        accessibilityState={{ selected: favorite }}
        hitSlop={10}
        style={styles.star}
        onPress={() => (void Haptics.selectionAsync(), toggleFavorite(choice.key))}
      >
        <Glyph name="star" size={17} filled={favorite} color={favorite ? theme.run : theme.faint} weight={1.6} />
      </Pressable>
    </View>
  )
}

/** The reasoning levels the bot's model takes. Picking the one it uses by itself leaves the choice to the model. */
function Reasoning({ model, effort, theme, set }: { model: ModelInfo; effort: Effort; theme: Theme; set: (effort: Effort) => void }) {
  const levels = effortsOf(model)
  const usual = model.defaultEffort
  // With no level chosen the model uses its own; that is the one shown as picked, when it is known.
  const selected = effort || usual || ''
  if (!levels.length) return <Text style={[styles.reasoningHead, styles.reasoning, { color: theme.faint }]}>This model has no reasoning setting.</Text>
  // One segment per level, all on one line, the picked one raised like iOS's own segmented controls.
  const level = (value: Effort, label: string) => (
    <Pressable
      key={value || 'auto'}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected === value }}
      style={[styles.level, selected === value && [styles.levelOn, { backgroundColor: theme.segment }]]}
      onPress={() => selected !== value && set(value === usual ? '' : value)}
    >
      <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: selected === value ? '600' : '400' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
    </Pressable>
  )
  return (
    <View style={styles.reasoning} accessibilityRole="radiogroup" accessibilityLabel="Reasoning">
      <Text style={[styles.reasoningHead, { color: theme.faint }]}>Reasoning{usual ? ` · ${EFFORT_LABEL[usual]} by default` : ''}</Text>
      <View style={[styles.levels, { backgroundColor: theme.bubble }]}>
        {!usual && level('', 'Auto')}
        {levels.map((value) => level(value, EFFORT_LABEL[value]))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  top: { paddingTop: 10 },
  head: { height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  done: { position: 'absolute', right: 20 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, marginHorizontal: 16, paddingHorizontal: 10, borderRadius: 11 },
  searchInput: { flex: 1, height: 38, fontSize: 16 },
  tabs: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 13, borderRadius: 17 },
  caption: { fontSize: 12.5, paddingHorizontal: 20, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  pick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingLeft: 20, paddingRight: 8, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontSize: 16 },
  tag: { fontSize: 11.5, paddingHorizontal: 6, paddingVertical: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 5, overflow: 'hidden' },
  star: { justifyContent: 'center', paddingLeft: 8, paddingRight: 20 },
  // Lined up with the model's name, under it.
  reasoning: { paddingLeft: 52, paddingRight: 20, paddingBottom: 14, gap: 8 },
  reasoningHead: { fontSize: 12.5 },
  levels: { flexDirection: 'row', padding: 2, borderRadius: 10 },
  level: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 8 },
  levelOn: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  more: { paddingHorizontal: 52, paddingVertical: 12 },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 32, paddingTop: 36 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
})
