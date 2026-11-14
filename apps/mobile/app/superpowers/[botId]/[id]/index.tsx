// One superpower, for one bot: the phone's version of its page on the computer. The top says what it
// is for and either activates it or says how it stands, with what can be done about that; then what
// a bot can do with it, what it gives a bot (the skill to read, the app's tools, a webhook), and its
// own page, its README. Once the main button scrolls away, the bar repeats it.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import type { Bot, Superpower, SuperpowerStatus } from '@openkumi/shared'
import { unwrap } from '@openkumi/client/superpowers'
import { hookStanding } from '@openkumi/client/webhooks'
import { useStore } from '@openkumi/client/store'
import { Glyph, SuperpowerIcon } from '../../../../src/icons'
import { Markdown } from '../../../../src/Markdown'
import { ScreenTitle } from '../../../../src/ScreenTitle'
import { ICON_INSET, Row, Section } from '../../../../src/SettingsUi'
import { activate, check, deactivate, useAttempt } from '../../../../src/superpowers'
import { type Theme, useTheme } from '../../../../src/theme'

/** The top's main button, which the bar repeats once it has scrolled away, in fewer words. */
interface Main {
  label: string
  short: string
  run: () => void
  busy?: boolean
}

export default function SuperpowerScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { botId, id } = useLocalSearchParams<{ botId: string; id: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  const status = useStore((s) => s.superpowerStatus[botId]?.[id])
  const hook = useStore((s) => s.hooks.find((h) => h.botId === botId && h.power === id))
  const attempt = useAttempt(botId, id)
  const large = useWindowDimensions().fontScale > 1.35
  /** Where the main button ends (where the top is, and where the button is in it), and whether it has scrolled out of sight. */
  const [heroY, setHeroY] = useState(0)
  const [buttonEnd, setButtonEnd] = useState(Infinity)
  const [past, setPast] = useState(false)
  useEffect(() => void (power?.service && check(botId).catch(() => {})), [botId, power?.service])
  // Turning green once connected is felt as well as seen.
  const was = useRef(status?.state)
  useEffect(() => {
    if (was.current && was.current !== 'connected' && status?.state === 'connected') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    was.current = status?.state
  }, [status?.state])
  if (!bot || !power) return null

  const on = bot.superpowers.includes(power.id)
  const signIn = (again = false) => router.push({ pathname: '/superpowers/[botId]/[id]/sign-in', params: { botId: bot.id, id: power.id, ...(again ? { again: '1' } : {}) } })
  const main: Main | null = !on
    ? attempt.busy === 'activating' || attempt.busy === 'signing-in'
      ? { label: attempt.busy === 'signing-in' ? 'Signing in…' : 'Activating…', short: '', run: () => {}, busy: true }
      : { label: 'Activate superpower', short: 'Activate', run: () => (power.signIn ? signIn() : void activate(bot, power)) }
    : status?.state === 'needs-login' && power.signIn
      ? { label: 'Sign in again', short: 'Sign in again', run: () => signIn(true) }
      : status?.state === 'error'
        ? { label: 'Try again', short: 'Try again', run: () => void check(bot.id).catch(() => {}) }
        : null
  const files = power.files
  const openFiles = () =>
    files.length === 1
      ? router.push({ pathname: '/superpowers/[botId]/[id]/file', params: { botId: bot.id, id: power.id, path: files[0] } })
      : router.push({ pathname: '/superpowers/[botId]/[id]/files', params: { botId: bot.id, id: power.id } })
  const site = power.site ? new URL(power.site).host.replace(/^www\./, '') : ''

  return (
    <>
      <ScreenTitle title={power.name} subtitle={bot.name} reserve={past && main ? (main.busy ? 44 : main.short.length * 10 + 32) : 0} />
      {past && main && (
        <Stack.Toolbar placement="right">
          {main.busy ? (
            <Stack.Toolbar.View>
              <ActivityIndicator accessibilityLabel={main.label} color={theme.muted} style={{ width: 44 }} />
            </Stack.Toolbar.View>
          ) : (
            <Stack.Toolbar.Button accessibilityLabel={main.label} onPress={main.run}>{main.short}</Stack.Toolbar.Button>
          )}
        </Stack.Toolbar>
      )}
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.group }}
        contentContainerStyle={[styles.page, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        scrollEventThrottle={32}
        onScroll={(e) => setPast(e.nativeEvent.contentOffset.y > heroY + buttonEnd)}
      >
        <View style={styles.hero} onLayout={(e) => setHeroY(e.nativeEvent.layout.y)}>
          <View style={styles.heroTop}>
            <SuperpowerIcon power={power} size={64} />
            <View style={styles.heroText}>
              {/* At the larger text sizes the bar's title is smaller than the page's text, so the name is said here too. */}
              {large && <Text accessibilityRole="header" style={[styles.tagline, { color: theme.text, fontWeight: '700' }]}>{power.name}</Text>}
              <Text style={[styles.tagline, { color: theme.text }]}>{power.tagline}</Text>
              <View style={styles.pills}>
                {power.categories.map((c) => (
                  <Pressable
                    key={c}
                    accessibilityRole="link"
                    accessibilityHint={`Shows the superpowers in ${c}`}
                    hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                    style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? theme.bubble : theme.groupCard, borderColor: theme.border }]}
                    onPress={() => router.dismissTo({ pathname: '/superpowers/[botId]', params: { botId: bot.id, group: c, at: String(Date.now()) } })}
                  >
                    <Text style={[styles.pillText, { color: theme.text }]}>{c}</Text>
                    <Glyph name="chevron" size={10} color={theme.faint} weight={2.6} />
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <Top bot={bot} power={power} status={status} on={on} main={main} hooked={!!hook} placed={setButtonEnd} />
        </View>

        <Section title="What a bot can do with it" inset={ICON_INSET}>
          {power.can.map((line) => (
            <View key={line} style={styles.can}>
              <View style={styles.canMark}><Glyph name="check" size={17} color={theme.ok} weight={2.2} /></View>
              <Text style={[styles.canText, { color: theme.text }]}>{line}</Text>
            </View>
          ))}
        </Section>

        <Section title="What it gives a bot" inset={ICON_INSET}>
          {files.length > 0 && (
            <Row
              icon="book"
              label={files.length > 1 ? `Read the skill · ${files.length} files` : 'Read the skill'}
              detail={`${files.length > 1 ? `${files[0]} and ${files.length - 1} more` : files[0]} · what ${bot.name} follows when a task calls for it`}
              opens
              onPress={openFiles}
            />
          )}
          {!!power.service && (
            <Row
              icon="plug"
              label={`${power.name} tools`}
              detail={`From ${power.service}.${power.signIn ? ' Each bot uses its own sign-in, kept where the bot itself cannot read it.' : ''}`}
            />
          )}
          {/* A webhook is set up on the computer; here is only how it stands. */}
          {power.hooks && on && (
            <Row icon="bolt" label="Webhook" detail={hook ? hookStanding(hook, power.name) : `Not set up. Set it up on ${power.name}’s page in OpenKumi on your computer.`} />
          )}
        </Section>

        <Section title="About" inset={ICON_INSET}>
          <View style={styles.about}><Markdown text={unwrap(power.about)} /></View>
          {!!site && <Row icon="globe" label={site} detail="Opens in Safari" onPress={() => void Linking.openURL(power.site)} />}
        </Section>
      </ScrollView>
    </>
  )
}

/**
 * The top of the page, under what it is for: the main button, or how the superpower stands for the
 * bot. Every state takes the same place, so the page below never jumps. Deactivate is right under
 * how it stands, as the computer has it by the name.
 */
function Top({ bot, power, status, on, main, hooked, placed }: { bot: Bot; power: Superpower; status: SuperpowerStatus | undefined; on: boolean; main: Main | null; hooked: boolean; placed: (end: number) => void }) {
  const theme = useTheme()
  const router = useRouter()
  const attempt = useAttempt(bot.id, power.id)
  // With no main button there is nothing for the bar to repeat.
  useEffect(() => void (!main && placed(Infinity)), [!main])
  const button = main && <MainButton main={main} theme={theme} placed={placed} />
  const error = attempt.error && (
    <View style={styles.error}>
      <Glyph name="info" size={15} color={theme.err} weight={2.2} />
      <Text style={[styles.errorText, { color: theme.err }]}>{attempt.error}</Text>
    </View>
  )
  if (!on) {
    return (
      <>
        {button}
        {error ?? (
          <Text style={[styles.hint, { color: theme.muted }]}>
            {power.signIn ? `Next, you choose where ${bot.name} signs in to ${power.name}.` : `Nothing to sign in to. ${bot.name} can use it as soon as it is active.`}
          </Text>
        )}
      </>
    )
  }
  const off = (
    <View style={[styles.offCard, { backgroundColor: theme.groupCard }]}>
      <Row
        label={attempt.busy === 'deactivating' ? 'Deactivating…' : 'Deactivate superpower'}
        tone={attempt.busy === 'deactivating' ? 'normal' : 'destructive'}
        disabled={attempt.busy === 'deactivating'}
        onPress={() => deactivate(bot, power, status, hooked)}
      />
    </View>
  )
  const ok = (detail: string) => <Standing theme={theme} tone="ok" title={`Active for ${bot.name}`} detail={detail} lead={<Glyph name="check" size={17} color={theme.okText} weight={2.4} />} />
  const state = !power.service ? 'skill' : (status?.state ?? 'connecting')
  return (
    <>
      {state === 'skill' && ok('Nothing to sign in to.')}
      {state === 'connected' && ok(`${status!.signedIn ? 'Signed in' : 'Connected'} · ${status!.tools} ${status!.tools === 1 ? 'tool' : 'tools'}`)}
      {state === 'connecting' && <Standing theme={theme} tone="wait" title={`Connecting to ${power.name}…`} lead={<ActivityIndicator size="small" color={theme.muted} />} />}
      {state === 'needs-login' && (
        <Standing theme={theme} tone="bad" title="Not signed in any more" detail={`${bot.name} cannot use ${power.name} until it signs in again.`} lead={<Glyph name="warn" size={17} color={theme.err} weight={2.2} />} />
      )}
      {state === 'error' && (
        <Standing
          theme={theme}
          tone="bad"
          title={`Couldn’t connect to ${power.name}`}
          detail="Tap for the details."
          lead={<Glyph name="info" size={17} color={theme.err} weight={2.2} />}
          onPress={() => router.push({ pathname: '/superpowers/[botId]/[id]/problem', params: { botId: bot.id, id: power.id } })}
        />
      )}
      {button}
      {state === 'error' && <Text style={[styles.hint, { color: theme.muted }]}>Also retries {bot.name}’s other apps that are down.</Text>}
      {off}
      {error}
    </>
  )
}

function MainButton({ main, theme, placed }: { main: Main; theme: Theme; placed: (end: number) => void }) {
  const plain = main.label === 'Try again'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!main.busy, busy: !!main.busy }}
      disabled={main.busy}
      onLayout={(e) => placed(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      onPress={main.run}
      style={({ pressed }) => [styles.button, { backgroundColor: theme.primary, opacity: main.busy ? 0.55 : pressed ? 0.8 : 1 }]}
    >
      {main.busy && <ActivityIndicator size="small" color={theme.onPrimary} />}
      {plain && <Glyph name="retry" size={17} color={theme.onPrimary} weight={2} />}
      <Text style={[styles.buttonText, { color: theme.onPrimary }]}>{main.label}</Text>
    </Pressable>
  )
}

/** How it stands, in the button's place: green when it works, red when it does not, plain while waiting. */
function Standing({ theme, tone, title, detail, lead, onPress }: { theme: Theme; tone: 'ok' | 'bad' | 'wait'; title: string; detail?: string; lead: ReactNode; onPress?: () => void }) {
  const background = tone === 'ok' ? theme.okTint : tone === 'bad' ? theme.errTint : theme.groupCard
  const body = (
    <>
      <View style={styles.standingLead}>{lead}</View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[styles.standingTitle, { color: theme.text }]}>{title}</Text>
        {!!detail && <Text style={[styles.standingDetail, { color: theme.muted }]}>{detail}</Text>}
      </View>
      {onPress && <Glyph name="chevron" size={15} color={theme.muted} weight={2.2} />}
    </>
  )
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityHint="Shows the error in full" onPress={onPress} style={({ pressed }) => [styles.standing, { backgroundColor: background, opacity: pressed ? 0.7 : 1 }]}>{body}</Pressable>
  ) : (
    <View accessible style={[styles.standing, { backgroundColor: background }]}>{body}</View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 14, gap: 26 },
  hero: { gap: 14, paddingHorizontal: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  heroText: { flex: 1, minWidth: 200, gap: 8 },
  tagline: { fontSize: 16.5, lineHeight: 22 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28, paddingLeft: 11, paddingRight: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 13, fontWeight: '500' },
  button: { minHeight: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  hint: { fontSize: 13.5, lineHeight: 18, marginTop: -6, paddingHorizontal: 4 },
  error: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', marginTop: -4, paddingHorizontal: 4 },
  errorText: { flex: 1, fontSize: 13.5, lineHeight: 18 },
  standing: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  standingLead: { width: 20, alignItems: 'center' },
  standingTitle: { fontSize: 15.5, fontWeight: '600' },
  standingDetail: { fontSize: 13.5, lineHeight: 18 },
  offCard: { borderRadius: 14, overflow: 'hidden' },
  can: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  canMark: { width: 24, alignItems: 'center', paddingTop: 2 },
  canText: { flex: 1, fontSize: 16.5, lineHeight: 21 },
  about: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
})
