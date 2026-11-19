// A call with a bot, as a screen of its own: the bot, how long the two have been talking, what is
// being said, and the three things to do on a call: mute, put it on the loudspeaker or at the ear,
// and hang up. It comes up when a call is made and goes by itself when the call is over. Put away
// (pulled down, or with the arrow), the call goes on, and a bar over the app leads back here
// (src/CallBar.tsx). The call itself is made in @openkumi/client/calls and src/calls.ts.
import { useEffect, useRef } from 'react'
import { ActivityIndicator, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { endCall, hangUp, mute, useCallShown } from '@openkumi/client/calls'
import { useStore } from '@openkumi/client/store'
import { Elapsed, HANG_UP } from '../src/CallBar'
import { setLoud, useCallSound } from '../src/calls'
import { Glyph, type GlyphName } from '../src/icons'
import { Mascot, Talking } from '../src/Mascot'
import { useTheme } from '../src/theme'

/** One of the round buttons at the foot, with what it does written under it. */
function Round({ icon, label, says, on, tone, disabled, onPress }: { icon: GlyphName; label: string; says?: string; on?: boolean; tone?: 'end'; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme()
  const end = tone === 'end'
  const background = end ? HANG_UP : on ? theme.primary : theme.bubble
  const color = end ? '#fff' : on ? theme.onPrimary : theme.text
  return (
    <View style={[styles.round, { opacity: disabled ? 0.4 : 1 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={says ?? label}
        accessibilityState={on === undefined ? { disabled } : { selected: on, disabled }}
        disabled={disabled}
        style={({ pressed }) => [styles.circle, { backgroundColor: background, opacity: pressed ? 0.75 : 1 }]}
        onPress={() => (void Haptics.impactAsync(end ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light), onPress())}
      >
        <Glyph name={icon} size={end ? 36 : 26} color={color} filled={end} weight={end ? 1 : 1.8} />
      </Pressable>
      <Text style={{ color: theme.muted, fontSize: 13 }} numberOfLines={1}>{label}</Text>
    </View>
  )
}

export default function CallScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { calling, call, mine, elsewhere, bot, status } = useCallShown()
  const lines = useStore((s) => s.callLines)
  const saying = useStore((s) => s.callSaying)
  const sound = useCallSound()
  const words = useRef<ScrollViewInstance>(null)

  // The call is over, by a hang-up here or elsewhere or by itself: there is nothing left to show.
  // Why it ended, when it ended by itself, is said by the bar this goes back to.
  const on = mine || elsewhere
  useEffect(() => {
    if (!on && router.canGoBack()) router.back()
  }, [on])

  if (!on || !bot) return <View style={{ flex: 1, backgroundColor: theme.bg }} />

  const live = calling.phase === 'live'
  const heard = [
    ...lines.slice(-30),
    ...(saying.user.trim() ? [{ role: 'user' as const, text: saying.user, live: true }] : []),
    ...(saying.assistant.trim() ? [{ role: 'assistant' as const, text: saying.assistant, live: true }] : []),
  ]
  const end = () => void (mine ? hangUp() : endCall(call!.id).catch(() => {}))

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Put the call away" accessibilityHint="The call goes on" hitSlop={10} style={({ pressed }) => [styles.away, { backgroundColor: pressed ? theme.bubble : theme.side }]} onPress={() => router.back()}>
          <Glyph name="down" size={20} color={theme.text} weight={2} />
        </Pressable>
      </View>

      <View style={styles.who}>
        <Talking on={live && !!saying.assistant.trim()}>
          <Mascot look={bot.look} emoji={bot.emoji} size={150} live />
        </Talking>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{bot.name}</Text>
        <View style={styles.status} accessibilityLiveRegion="polite">
          {live && <Elapsed since={calling.since} size={15} />}
          {mine && !live && <ActivityIndicator size="small" color={theme.muted} />}
          <Text style={{ color: theme.muted, fontSize: 15 }}>{status}</Text>
        </View>
      </View>

      {/* What is being said, the newest at the foot and kept in view. */}
      <ScrollView ref={words} style={styles.heard} contentContainerStyle={styles.lines} onContentSizeChange={() => words.current?.scrollToEnd({ animated: true })} showsVerticalScrollIndicator={false}>
        {!heard.length && (live || elsewhere) && <Text style={[styles.hint, { color: theme.faint }]}>{elsewhere ? 'What is said shows here.' : `Say something: ${bot.name} is listening.`}</Text>}
        {heard.map((line, i) =>
          line.role === 'user' ? (
            <Text key={i} style={[styles.said, { backgroundColor: theme.bubble, color: theme.muted, opacity: 'live' in line ? 0.7 : 1 }]}>{line.text.trim()}</Text>
          ) : (
            <Text key={i} style={[styles.line, { color: theme.text, opacity: 'live' in line ? 0.7 : 1 }]}>{line.text.trim()}</Text>
          ),
        )}
      </ScrollView>

      <View style={styles.foot}>
        {mine && <Round icon={calling.muted ? 'micOff' : 'mic'} label={calling.muted ? 'Muted' : 'Mute'} says={calling.muted ? 'Unmute' : 'Mute'} on={calling.muted} disabled={!live} onPress={() => mute(!calling.muted)} />}
        {mine &&
          (sound.route.other ? (
            // Headphones or a car have the sound: it stays where its owner put it.
            <Round icon="speaker" label={sound.route.name || 'Headphones'} says={`The sound is on ${sound.route.name || 'headphones'}`} disabled onPress={() => {}} />
          ) : (
            <Round icon="speaker" label="Speaker" says={sound.loud ? 'Speaker, on. Hold the phone to your ear instead' : 'Speaker, off. Put the call on the speaker'} on={sound.loud} onPress={() => setLoud(!sound.loud)} />
          ))}
        <Round icon="hangUp" label={mine ? 'Hang up' : 'End the call'} tone="end" onPress={end} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  top: { flexDirection: 'row', paddingTop: 14, marginHorizontal: -6 },
  away: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  who: { alignItems: 'center', gap: 6, paddingTop: 4 },
  name: { fontSize: 24, fontWeight: '700', marginTop: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 22 },
  heard: { flex: 1, marginTop: 18 },
  lines: { flexGrow: 1, justifyContent: 'flex-end', gap: 10, paddingVertical: 8 },
  hint: { fontSize: 15, textAlign: 'center', paddingBottom: 12 },
  line: { fontSize: 17, lineHeight: 24 },
  said: { alignSelf: 'flex-end', maxWidth: '88%', fontSize: 16, lineHeight: 22, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16, overflow: 'hidden' },
  foot: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start', paddingTop: 14 },
  round: { alignItems: 'center', gap: 7, width: 96 },
  circle: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
})
