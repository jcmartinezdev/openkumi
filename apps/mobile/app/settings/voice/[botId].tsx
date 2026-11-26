// The voice a bot has on a call, chosen by ear: the voices side by side, one in view at a time,
// to swipe through, sorted female, male and by language (@openkumi/client/voices) with a switch
// over them for each. The one in view says what it is like, and a short line as the bot (the
// server has Codex put it on the line, as for a call), so it is heard the way it will sound; a
// button makes it the bot's.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, type FlatList, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useIsFocused, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useBotId } from '@openkumi/client/bots'
import { stopHearing, useCalling, useHearing, useVoices } from '@openkumi/client/calls'
import { type Shelf, type VoiceChoice, isVoice, shelvesOf } from '@openkumi/client/voices'
import { api, useStore } from '@openkumi/client/store'
import { hear } from '../../../src/calls'
import { Glyph } from '../../../src/icons'
import { Mascot, Talking } from '../../../src/Mascot'
import { ScreenTitle } from '../../../src/ScreenTitle'
import { Segments } from '../../../src/SettingsUi'
import { useTheme } from '../../../src/theme'

/** How much of the voices beside the one in view shows at each edge, which says there is more to the sides. */
const PEEK = 34
const GAP = 12

export default function Voice() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const focused = useIsFocused()
  const { botId: given } = useLocalSearchParams<{ botId: string }>()
  // Its id may change while this is open: the screen goes on with the bot.
  const botId = useBotId(given)
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const known = useVoices()
  const hearing = useHearing()
  const onCall = useCalling().phase !== 'off'
  const [saved, setSaved] = useState<string | null>(null)
  const mine = saved ?? bot?.voice ?? ''

  // Sorted once: the order does not move when one is chosen, and the bot's voice as the screen opened stays listed.
  const first = useRef(mine).current
  const shelves = useMemo(() => (known ? shelvesOf(known, first) : []), [known])
  /** The voices shown: the kind picked above them, at first the bot's own voice's. */
  const [picked, setPicked] = useState<Shelf | null>(null)
  const shelf = shelves.find((one) => one.shelf === picked) ?? shelves.find((one) => one.voices.some((choice) => isVoice(choice, first))) ?? shelves[0]
  const pages = shelf?.voices ?? []
  /** Where among them the bot's voice is, for them to open at. */
  const startOf = (voices: VoiceChoice[]) => Math.max(0, voices.findIndex((choice) => isVoice(choice, mine)))

  const step = width - 2 * PEEK
  const list = useRef<FlatList<VoiceChoice>>(null)
  const x = useRef(new Animated.Value(0)).current
  /** The voice in view, as a place among the kind shown. Until a swipe, the bot's own voice, or the first. */
  const [view, setView] = useState<{ shelf: Shelf; at: number } | null>(null)
  const at = view && view.shelf === shelf?.shelf ? view.at : startOf(pages)
  const setAt = (to: number) => shelf && setView({ shelf: shelf.shelf, at: to })
  // Each kind opens at the bot's own voice, when it is one of them.
  useEffect(() => {
    if (!pages.length) return
    const start = startOf(pages)
    x.setValue(start * step)
    if (start) setTimeout(() => list.current?.scrollToOffset({ offset: start * step, animated: false }), 0)
  }, [shelf?.shelf, !!known])

  // A voice swiped to says its line by itself, once the swiping has come to rest on it.
  const swiped = useRef(false)
  useEffect(() => {
    if (!swiped.current || !bot || !pages[at] || onCall) return
    // One that cannot be heard stops the one that was talking.
    if (pages[at].gone) return void stopHearing()
    const { value } = pages[at]
    const wait = setTimeout(() => hear(bot.id, value), 350)
    return () => clearTimeout(wait)
  }, [at, shelf?.shelf])
  /** Another kind of voice: its voices take the place of these, and none says anything until swiped to. */
  const show = (next: Shelf) => {
    void Haptics.selectionAsync()
    swiped.current = false
    stopHearing()
    setView(null)
    setPicked(next)
  }
  // The voice only speaks to a line that sends it sound, so hearing one needs the microphone, switched off as it is.
  useEffect(() => {
    if (!hearing.denied) return
    Alert.alert('Allow the microphone', 'A voice is heard over a line like a call’s, which needs the microphone even though nothing you say is sent. You can allow it in Settings.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ])
  }, [hearing.denied])
  // Nothing goes on talking once the page is left.
  useEffect(() => {
    if (!focused) stopHearing()
    return () => stopHearing()
  }, [focused])

  if (!bot) return null
  const page = pages[at]
  const go = (to: number) => {
    if (to < 0 || to >= pages.length) return
    swiped.current = true
    list.current?.scrollToOffset({ offset: to * step, animated: true })
    setAt(to)
  }
  const choose = () => {
    if (!page || page.gone) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setSaved(page.value)
    api('PATCH', `/api/bots/${bot.id}`, { voice: page.value }).catch((e) => (setSaved(null), Alert.alert('Not saved', (e as Error).message)))
  }
  const chosen = !!page && isVoice(page, mine)

  return (
    <View style={[styles.screen, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <ScreenTitle title="Voice" subtitle={bot.name} />
      {!pages.length || !shelf ? (
        <View style={styles.waiting}><ActivityIndicator color={theme.muted} /></View>
      ) : (
        <>
          {shelves.length > 1 && (
            <View style={styles.shelves}>
              <Segments label="Kind of voice" value={shelf.shelf} options={shelves.map((one) => [one.shelf, one.title] as const)} onChange={show} />
            </View>
          )}
          <Animated.FlatList
            // Each kind of voice is a list of its own, which starts at its beginning.
            key={shelf.shelf}
            ref={list}
            data={pages}
            keyExtractor={(item) => item.voice}
            horizontal
            style={styles.list}
            showsHorizontalScrollIndicator={false}
            // One voice at a time: a swipe goes to the next and no further.
            snapToInterval={step}
            decelerationRate="fast"
            disableIntervalMomentum
            contentContainerStyle={{ paddingHorizontal: PEEK, alignItems: 'center' }}
            getItemLayout={(_, index) => ({ length: step, offset: step * index, index })}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => (swiped.current = true)}
            onMomentumScrollEnd={(e) => setAt(Math.max(0, Math.min(pages.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))))}
            renderItem={({ item, index }) => {
              const here = hearing.voice === item.value && hearing.phase !== 'off'
              const speaking = here && hearing.phase === 'speaking'
              // The ones to the sides stand back a little.
              const around = [(index - 1) * step, index * step, (index + 1) * step]
              const scale = x.interpolate({ inputRange: around, outputRange: [0.92, 1, 0.92], extrapolate: 'clamp' })
              const opacity = x.interpolate({ inputRange: around, outputRange: [0.45, 1, 0.45], extrapolate: 'clamp' })
              const has = isVoice(item, mine)
              // The kind is the switch's, so a card says only what more there is.
              const about = item.shelf === 'female' || item.shelf === 'male' ? item.about : item.language
              return (
                <Animated.View style={{ width: step, paddingHorizontal: GAP / 2, opacity, transform: [{ scale }] }}>
                  <View style={[styles.card, { backgroundColor: theme.groupCard, borderColor: has ? theme.text : 'transparent' }]}>
                    <Talking on={speaking}><Mascot look={bot.look} emoji={bot.emoji} size={128} live={index === at} /></Talking>
                    <Text style={[styles.name, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>{item.name}</Text>
                    <Text style={[styles.about, { color: theme.text }]} numberOfLines={1}>{about || ' '}</Text>
                    <View style={styles.chips}>
                      {has && <Text style={[styles.chip, { color: theme.okText, backgroundColor: theme.okTint, fontWeight: '600' }]}>{bot.name}’s voice</Text>}
                      {item.usual && <Text style={[styles.chip, { color: theme.muted, backgroundColor: theme.bubble }]}>The usual one</Text>}
                      {item.gone && <Text style={[styles.chip, { color: theme.muted, backgroundColor: theme.bubble }]}>No longer offered</Text>}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={here ? `Stop ${item.name}` : `Hear ${item.name}`}
                      disabled={item.gone || onCall || index !== at}
                      style={({ pressed }) => [styles.play, { backgroundColor: theme.primary, opacity: item.gone || onCall ? 0.3 : pressed ? 0.8 : 1 }]}
                      onPress={() => (void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), here ? stopHearing() : hear(bot.id, item.value))}
                    >
                      {here && !speaking ? (
                        <ActivityIndicator color={theme.onPrimary} />
                      ) : speaking ? (
                        <View style={[styles.stop, { backgroundColor: theme.onPrimary }]} />
                      ) : (
                        <View style={{ marginLeft: 3 }}><Glyph name="play" size={26} color={theme.onPrimary} filled weight={1.5} /></View>
                      )}
                    </Pressable>
                    <Text style={[styles.says, { color: theme.muted }]} numberOfLines={2}>
                      {speaking ? `“Hi, I’m ${bot.name}. This is how I sound when you call me.”` : here ? 'Getting the voice on the line…' : item.gone ? 'It cannot be heard any more.' : 'Hear it'}
                    </Text>
                  </View>
                </Animated.View>
              )
            }}
          />

          <View style={styles.count}>
            <Pressable accessibilityRole="button" accessibilityLabel="The voice before" hitSlop={12} disabled={at === 0} style={{ opacity: at === 0 ? 0.25 : 1 }} onPress={() => go(at - 1)}>
              <View style={{ transform: [{ rotate: '180deg' }] }}><Glyph name="chevron" size={18} color={theme.text} weight={2.2} /></View>
            </Pressable>
            <Text style={{ color: theme.muted, fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'center' }}>{at + 1} of {pages.length}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="The next voice" hitSlop={12} disabled={at === pages.length - 1} style={{ opacity: at === pages.length - 1 ? 0.25 : 1 }} onPress={() => go(at + 1)}>
              <Glyph name="chevron" size={18} color={theme.text} weight={2.2} />
            </Pressable>
          </View>

          <View style={styles.foot}>
            {(onCall || (!!hearing.error && !hearing.denied)) && <Text accessibilityRole="alert" style={[styles.note, { color: onCall ? theme.muted : theme.err }]}>{onCall ? 'You are on a call. Hang up to hear the voices.' : hearing.error}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: chosen || !!page?.gone }}
              disabled={chosen || !page || page.gone}
              style={({ pressed }) => [styles.use, { backgroundColor: chosen ? theme.bubble : theme.primary, opacity: pressed ? 0.85 : 1 }]}
              onPress={choose}
            >
              {chosen && <Glyph name="check" size={18} color={theme.muted} weight={2.4} />}
              <Text style={{ color: chosen ? theme.muted : theme.onPrimary, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
                {chosen ? `This is ${bot.name}’s voice` : page ? `Use ${page.name}` : ''}
              </Text>
            </Pressable>
            <Text style={[styles.note, { color: theme.faint }]}>Swipe to hear the others. Each one says a line over your ChatGPT plan, like a very short call.</Text>
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 1 },
  card: { alignItems: 'center', gap: 6, paddingTop: 30, paddingBottom: 24, paddingHorizontal: 20, borderRadius: 32, borderWidth: 2 },
  name: { fontSize: 32, fontWeight: '700', marginTop: 10 },
  about: { fontSize: 17, marginTop: -4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, minHeight: 22 },
  chip: { fontSize: 12, fontWeight: '500', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 11, overflow: 'hidden' },
  shelves: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 },
  play: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  stop: { width: 20, height: 20, borderRadius: 4 },
  says: { fontSize: 14, lineHeight: 19, textAlign: 'center', minHeight: 38, marginTop: 8 },
  count: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 14 },
  foot: { paddingHorizontal: 20, gap: 12 },
  use: { height: 54, borderRadius: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
})
