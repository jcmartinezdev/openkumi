// Dictation in the composer: a microphone button, and while it listens a bar in place of the
// composer's buttons, with a way to give up, how loud it is, how long it has been, and a way to
// finish. What is said is written down on the phone (@openkumi/dictation) and goes into the draft
// as it is heard (@openkumi/client/dictation); only the words are ever sent, and only when sent.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { Dictating } from '@openkumi/client/dictation'
import type { Listener } from '@openkumi/shared/dictation'
import { Glyph } from './icons'
import { useTheme } from './theme'

export { listener } from '@openkumi/dictation'

export function MicButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Dictate"
      hitSlop={6}
      style={({ pressed }) => [styles.round, pressed && { backgroundColor: theme.bubble }]}
      onPress={() => (void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), onPress())}
    >
      <Glyph name="mic" size={20} color={theme.text} weight={1.9} />
    </Pressable>
  )
}

const BARS = 22

/** How loud it is, as bars that move along from right to left. */
function Level({ listener }: { listener: Listener }) {
  const theme = useTheme()
  const [levels, setLevels] = useState(() => Array<number>(BARS).fill(0))
  useEffect(() => listener.onEvent((event) => event.type === 'level' && setLevels((was) => [...was.slice(1), event.level])), [listener])
  return (
    <View style={styles.level} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((level, i) => <View key={i} style={[styles.bar, { backgroundColor: theme.text, height: 3 + level * 17 }]} />)}
    </View>
  )
}

function Elapsed() {
  const theme = useTheme()
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(tick)
  }, [])
  return <Text style={[styles.elapsed, { color: theme.muted }]}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Text>
}

/** In place of the composer's buttons while it listens. */
export function ListeningBar({ dictating, listener }: { dictating: Dictating; listener: Listener }) {
  const theme = useTheme()
  const { phase, progress } = dictating
  const finishing = phase === 'finishing'
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel dictation" hitSlop={6} style={[styles.round, { borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]} onPress={dictating.cancel}>
        <Glyph name="x" size={16} color={theme.text} weight={2} />
      </Pressable>
      <View style={styles.middle} accessibilityRole="text" accessibilityLabel={phase === 'preparing' ? 'Getting the speech model ready' : 'Listening'}>
        {phase === 'preparing' ? (
          <>
            <ActivityIndicator size="small" color={theme.muted} />
            <Text style={{ color: theme.muted, fontSize: 14 }} numberOfLines={1}>Getting the speech model ready{progress > 0 ? ` · ${Math.round(progress * 100)}%` : ''}</Text>
          </>
        ) : (
          <>
            <View style={[styles.rec, { backgroundColor: phase === 'starting' ? theme.faint : theme.err }]} />
            {/* Counted from when the microphone is on, not while the phone asks whether it may be. */}
            {phase !== 'starting' && <Elapsed />}
            <Level listener={listener} />
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish dictation"
        disabled={finishing}
        style={[styles.round, { backgroundColor: theme.primary }]}
        onPress={() => (void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), dictating.finish())}
      >
        {finishing ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <Glyph name="check" size={18} color={theme.onPrimary} weight={2.4} />}
      </Pressable>
    </>
  )
}

/**
 * What else dictation needs from the chat: it finishes when the app goes into the background, where
 * the phone stops listening anyway, and says why when it stopped early.
 */
export function useDictationChecks(dictating: Dictating) {
  const speaking = dictating.phase !== 'off'
  useEffect(() => {
    if (!speaking) return
    const watch = AppState.addEventListener('change', (state) => state === 'background' && dictating.finish())
    return () => watch.remove()
  }, [speaking])

  const failure = dictating.failure
  useEffect(() => {
    if (!failure) return
    dictating.dismiss()
    if (failure.code === 'denied') {
      Alert.alert('Allow the microphone', 'OpenKumi is not allowed to use the microphone. You can allow it in Settings.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ])
    } else Alert.alert('Dictation stopped', failure.message)
  }, [failure])
}

const styles = StyleSheet.create({
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 6 },
  rec: { width: 8, height: 8, borderRadius: 4 },
  elapsed: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 32 },
  level: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2.5, height: 20, overflow: 'hidden' },
  bar: { width: 2.5, borderRadius: 1.25, opacity: 0.6 },
})
