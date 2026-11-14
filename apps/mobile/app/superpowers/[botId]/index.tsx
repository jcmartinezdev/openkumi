// Every superpower there is, for one bot: to browse by what it is for, or to search, as on the
// computer. One the bot has says how it stands; each opens on its own page, which activates it for
// this bot. A superpower is in every group it belongs to; a search lists each once, from every
// group, as the model picker's search does. Reached from the bot's settings, which list only the
// ones it has, and from a group on a superpower's page, which opens the catalog on that group.
import { useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, TextInput, type TextInputInstance, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia'
import type { Superpower } from '@openkumi/shared'
import { matches, searchWords } from '@openkumi/client/superpowers'
import { useStore } from '@openkumi/client/store'
import { Glyph } from '../../../src/icons'
import { PowerRow } from '../../../src/PowerUi'
import { ScreenTitle } from '../../../src/ScreenTitle'
import { ICON_INSET, Note, Section } from '../../../src/SettingsUi'
import { check, standingOf, useStatuses } from '../../../src/superpowers'
import { useTheme } from '../../../src/theme'

export default function Catalog() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { botId, group, at } = useLocalSearchParams<{ botId: string; group?: string; at?: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const powers = useStore((s) => s.superpowers)
  const listed = useStore((s) => s.superpowerCategories)
  const statuses = useStatuses(botId)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(group ?? '')
  const [focused, setFocused] = useState(false)
  const field = useRef<TextInputInstance>(null)
  const list = useRef<ScrollViewInstance>(null)
  const chips = useRef<ScrollViewInstance>(null)
  /** Where each group's chip is along its row, and whether the chosen one still has to be brought into sight. */
  const chipAt = useRef(new Map<string, number>())
  const reveal = useRef(!!group)
  const showChip = (x: number) => chips.current?.scrollTo({ x: Math.max(0, x - 16), animated: false })
  useEffect(() => void check(botId).catch(() => {}), [botId])
  // Opened again on a group, from a superpower's page: that group, nothing searched.
  useEffect(() => {
    if (!group) return
    setCategory(group)
    setQuery('')
    field.current?.blur()
    list.current?.scrollTo({ y: 0, animated: false })
    const x = chipAt.current.get(group)
    if (x === undefined) reveal.current = true
    else showChip(x)
  }, [group, at])
  if (!bot) return null

  const categories = listed.length ? listed : [...new Set(powers.flatMap((p) => p.categories))]
  const words = searchWords(query)
  const searching = words.length > 0
  const shown = category && categories.includes(category) ? category : ''
  const groups: [title: string, powers: Superpower[]][] = searching
    ? [[`${powers.filter((p) => matches(p, words)).length} found · searching all groups`, powers.filter((p) => matches(p, words))]]
    : (shown ? [shown] : categories).map((c) => [c, powers.filter((p) => p.categories.includes(c))])
  // Ones in no listed group would otherwise not be shown at all.
  const loose = powers.filter((p) => !p.categories.some((c) => categories.includes(c)))
  if (!searching && !shown && loose.length) groups.push(['More', loose])
  const open = (power: Superpower) => {
    Keyboard.dismiss()
    router.push({ pathname: '/superpowers/[botId]/[id]', params: { botId: bot.id, id: power.id } })
  }
  const cancel = () => (setQuery(''), field.current?.blur())

  return (
    <>
      <ScreenTitle title="Superpowers" subtitle={bot.name} />
      <View style={[styles.top, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}>
        <View style={styles.searchLine}>
          <View style={[styles.search, { backgroundColor: theme.bubble }]}>
            <Glyph name="search" size={16} color={theme.faint} />
            <TextInput
              ref={field}
              accessibilityLabel="Search superpowers"
              style={[styles.searchInput, { color: theme.text }]}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={`Search ${powers.length} superpowers`}
              placeholderTextColor={theme.faint}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>
          {(focused || searching) && (
            <Pressable accessibilityRole="button" hitSlop={10} onPress={cancel}>
              <Text style={{ color: theme.text, fontSize: 16.5, fontWeight: '500' }}>Cancel</Text>
            </Pressable>
          )}
        </View>
        {/* While searching, the search covers every group, so the groups step aside. */}
        {!searching && (
          <View>
            <ScrollView ref={chips} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
              {[['', 'All', powers.length] as const, ...categories.map((c) => [c, c, powers.filter((p) => p.categories.includes(c)).length] as const)].map(([id, label, n]) => (
                <Pressable
                  key={id || 'all'}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: shown === id }}
                  accessibilityLabel={`${label}, ${n}`}
                  hitSlop={{ top: 5, bottom: 5 }}
                  style={[styles.chip, { backgroundColor: shown === id ? theme.primary : theme.bubble }]}
                  onPress={() => (setCategory(id), list.current?.scrollTo({ y: 0, animated: false }))}
                  onLayout={(e) => {
                    chipAt.current.set(id, e.nativeEvent.layout.x)
                    if (reveal.current && id === shown) (reveal.current = false), showChip(e.nativeEvent.layout.x)
                  }}
                >
                  <Text style={{ color: shown === id ? theme.onPrimary : theme.text, fontSize: 14.5, fontWeight: '500' }}>
                    {label} <Text style={{ color: shown === id ? theme.onPrimary : theme.faint, opacity: shown === id ? 0.6 : 1, fontWeight: '400' }}>{n}</Text>
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Fade color={theme.bg} />
          </View>
        )}
      </View>

      <ScrollView
        ref={list}
        style={{ flex: 1, backgroundColor: theme.group }}
        contentContainerStyle={[styles.page, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {!searching && <Note>What {bot.name} can do beyond its own tools. Only you can activate one; the bot cannot.</Note>}
        {groups.filter(([, list]) => list.length).map(([title, list]) => (
          <Section key={title} title={title} inset={ICON_INSET}>
            {list.map((power) => (
              <PowerRow
                key={power.id}
                power={power}
                standing={bot.superpowers.includes(power.id) ? standingOf(bot.id, power, statuses?.[power.id]) : undefined}
                words={words}
                onPress={() => open(power)}
              />
            ))}
          </Section>
        ))}
        {searching && !groups[0][1].length && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No superpowers match “{query.trim()}”</Text>
            <Text style={[styles.emptyText, { color: theme.muted }]}>Search looks in names, what each is for, groups and what it can do.</Text>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={cancel}>
              <Text style={[styles.emptyAction, { color: theme.text }]}>Clear search</Text>
            </Pressable>
          </View>
        )}
        {!powers.length && <Note>There are no superpowers in this version of OpenKumi.</Note>}
      </ScrollView>
    </>
  )
}

/** The end of the row of groups fades out, so it shows there is more of it to the side. */
function Fade({ color }: { color: string }) {
  return (
    <Canvas pointerEvents="none" style={styles.fade}>
      <Rect x={0} y={0} width={36} height={54}>
        <LinearGradient start={vec(0, 0)} end={vec(36, 0)} colors={[`${color}00`, color]} />
      </Rect>
    </Canvas>
  )
}

const styles = StyleSheet.create({
  top: { paddingTop: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  searchLine: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 10, borderRadius: 11 },
  searchInput: { flex: 1, height: 38, fontSize: 16 },
  chips: { gap: 8, paddingHorizontal: 16, paddingTop: 0, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 13, borderRadius: 17 },
  fade: { position: 'absolute', top: 0, right: 0, width: 36, height: 54 },
  page: { paddingHorizontal: 16, paddingTop: 14, gap: 26 },
  empty: { alignItems: 'center', gap: 6, paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 14.5, lineHeight: 20, textAlign: 'center' },
  emptyAction: { fontSize: 15, fontWeight: '600', marginTop: 6, textDecorationLine: 'underline' },
})
