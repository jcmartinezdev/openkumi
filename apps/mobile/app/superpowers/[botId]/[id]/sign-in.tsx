// Where a bot signs in to a superpower's app, asked as a sheet over its page: on this phone, with
// the accounts Safari has, or inside the bot's own browser, which suits a different account. The
// superpower is active once the bot is signed in. "again" signs a bot in that was signed out.
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useStore } from '@openkumi/client/store'
import { Glyph, type GlyphName, SuperpowerIcon } from '../../../../src/icons'
import { failed, signIn } from '../../../../src/superpowers'
import { useTheme } from '../../../../src/theme'

export default function SignInSheet() {
  const theme = useTheme()
  const router = useRouter()
  const { botId, id, again } = useLocalSearchParams<{ botId: string; id: string; again?: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  const [starting, setStarting] = useState<'app' | 'bot' | null>(null)
  const [error, setError] = useState('')
  if (!bot || !power) return null

  const choose = async (via: 'app' | 'bot') => {
    setStarting(via)
    setError('')
    try {
      await signIn(bot, power, via, router, () => router.back())
    } catch (e) {
      setError(failed('Couldn’t start the sign-in', e))
      setStarting(null)
    }
  }
  const title = again ? `Sign ${bot.name} in to ${power.name} again` : `Activate ${power.name}`

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheet} bounces={false}>
      <View style={styles.head}>
        <SuperpowerIcon power={power} size={40} />
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
          {!again && <Text style={[styles.subtitle, { color: theme.faint }]}>for {bot.name}</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={[styles.close, { backgroundColor: theme.bubble }]} onPress={() => router.back()}>
          <Glyph name="x" size={13} color={theme.muted} weight={2.4} />
        </Pressable>
      </View>
      <Text style={[styles.text, { color: theme.muted }]}>
        Choose where {bot.name} signs in to {power.name}.{again ? '' : ` It is active once ${bot.name} is signed in.`}
      </Text>
      {!!error && (
        <View accessibilityRole="alert" style={[styles.error, { backgroundColor: theme.errTint }]}>
          <Glyph name="info" size={16} color={theme.err} weight={2.2} />
          <Text style={[styles.errorText, { color: theme.err }]}>{error}</Text>
        </View>
      )}
      <View style={[styles.card, { backgroundColor: theme.groupCard }]}>
        <Choice icon="phone" label="Sign in on this phone" detail="With an account you use in Safari on this phone." busy={starting === 'app'} disabled={!!starting} onPress={() => void choose('app')} />
        <View style={[styles.line, { backgroundColor: theme.border }]} />
        <Choice
          icon="globe"
          label={`Sign in inside ${bot.name}’s browser`}
          detail={`On the computer that runs ${bot.name}. Good for a different account.`}
          busy={starting === 'bot'}
          disabled={!!starting}
          onPress={() => void choose('bot')}
        />
      </View>
    </ScrollView>
  )
}

function Choice({ icon, label, detail, busy, disabled, onPress }: { icon: GlyphName; label: string; detail: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && { backgroundColor: theme.bubble }, disabled && !busy && { opacity: 0.45 }]}
    >
      <View style={styles.choiceIcon}><Glyph name={icon} size={21} color={theme.text} weight={1.7} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.choiceLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.choiceDetail, { color: theme.muted }]}>{busy ? 'Starting…' : detail}</Text>
      </View>
      <Glyph name="chevron" size={15} color={theme.faint} weight={2.2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  title: { fontSize: 19, fontWeight: '700' },
  subtitle: { fontSize: 13.5 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14.5, lineHeight: 20, paddingHorizontal: 4 },
  error: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 19 },
  card: { borderRadius: 16, overflow: 'hidden' },
  line: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  choiceIcon: { width: 24, alignItems: 'center' },
  choiceLabel: { fontSize: 16.5, lineHeight: 21 },
  choiceDetail: { fontSize: 13.5, lineHeight: 18 },
})
