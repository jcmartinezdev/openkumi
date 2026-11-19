// A call, small, over whatever screen is showing: who is on the line and for how long, and a way
// to hang up. It is there while the phone is on a call and the call's own screen (app/call.tsx) is
// put away, so a call goes on while its owner reads the conversation or looks at something else;
// tapping it brings the call's screen back. A call made from another device shows here too, and
// one that ended by itself says why until that is dismissed.
import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter, useSegments } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { callTime, dismissCallError, endCall, hangUp, useCallShown, useCalling } from '@openkumi/client/calls'
import { useStore } from '@openkumi/client/store'
import { Glyph } from './icons'
import { Bobbing, BotHead } from './Mascot'
import { useTheme } from './theme'

/** The red of hanging up, the same in light and dark: white reads on it. */
export const HANG_UP = '#dc2626'

/** How much of the top of a screen the bar takes: every screen starts that much lower while it shows (app/_layout.tsx). */
export const CALL_BAR = 66

/** Whether the bar is showing over the screens. */
export function useCallBar(): boolean {
  const calling = useCalling()
  const call = useStore((s) => s.call)
  return calling.phase !== 'off' || (!!call && call.id !== calling.last) || (!!calling.error && !calling.denied)
}

/** The room the bar takes at the top of a screen, for a screen that reckons with where it starts (the keyboard's place, say). */
export const useCallBarRoom = () => (useCallBar() ? CALL_BAR : 0)

/** "0:42", counted from when the voice came on the line. */
export function Elapsed({ since, size = 13 }: { since: number; size?: number }) {
  const theme = useTheme()
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [])
  return <Text style={{ color: theme.okText, fontSize: size, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{callTime(since)}</Text>
}

export function CallBar() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { calling, call, mine, elsewhere, bot, status } = useCallShown()
  // The call's own screen says all of this itself.
  const onItsScreen = useSegments()[0] === 'call'

  // A microphone that may not be used is put right in the phone's settings, so it is asked about rather than only said.
  const denied = calling.denied
  useEffect(() => {
    if (!denied) return
    dismissCallError()
    Alert.alert('Allow the microphone', 'OpenKumi is not allowed to use the microphone, so it cannot call a bot. You can allow it in Settings.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ])
  }, [denied])

  if (onItsScreen) return null
  // Under the bar at the top of a screen, which every screen a call can be seen from has, in the room the screens leave for it.
  const place = [styles.bar, { top: insets.top + 50, backgroundColor: theme.raised, borderColor: theme.border }]

  if (!mine && !elsewhere) {
    if (!calling.error || denied) return null
    return (
      <View style={place} accessibilityRole="alert">
        <View style={[styles.mark, { backgroundColor: theme.errTint }]}><Glyph name="handset" size={16} color={theme.err} /></View>
        <View style={styles.words}>
          <Text style={[styles.name, { color: theme.text }]}>The call ended</Text>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18 }}>{calling.error}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10} style={styles.dismiss} onPress={dismissCallError}>
          <Glyph name="x" size={15} color={theme.muted} weight={2} />
        </Pressable>
      </View>
    )
  }
  if (!bot) return null

  const live = calling.phase === 'live'
  const head = <BotHead bot={bot} size={36} sign={false} />
  return (
    <View style={place}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Call with ${bot.name}. ${status}`} accessibilityHint="Shows the call" style={styles.who} onPress={() => router.push('/call')}>
        {live ? <Bobbing>{head}</Bobbing> : head}
        <View style={styles.words}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{bot.name}</Text>
          <View style={styles.status}>
            {live && <Elapsed since={calling.since} />}
            <Text style={{ flexShrink: 1, color: theme.muted, fontSize: 13 }} numberOfLines={1}>{status}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hang up"
        hitSlop={6}
        style={({ pressed }) => [styles.hangUp, { backgroundColor: HANG_UP, opacity: pressed ? 0.8 : 1 }]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          void (mine ? hangUp() : endCall(call!.id).catch(() => {}))
        }}
      >
        <Glyph name="hangUp" size={24} color="#fff" filled weight={1} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 12, paddingRight: 10, paddingVertical: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  words: { flex: 1, gap: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hangUp: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dismiss: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
})
