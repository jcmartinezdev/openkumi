// The window one of a bot's threads browses in, live. It is watched until the owner takes control;
// then they tap, scroll and type into the page themselves, and the bot can only read it until they
// hand it back. Leaving the screen hands it back too.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, type GestureResponderEvent, Keyboard, KeyboardAvoidingView, type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Canvas, Image } from '@shopify/react-native-skia'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BrowserInput } from '@openbot/shared'
import { control, driverOf, hostOf, sessionName, windowOf } from '@openbot/client/browser'
import { api, mainThread, send, useStore } from '@openbot/client/store'
import { fit, useLivePage } from '../../src/LivePage'
import { ScreenTitle } from '../../src/ScreenTitle'
import { useTheme } from '../../src/theme'

export default function Browser() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  // No thread is the bot's conversation; `take` asks for control as soon as the window is there.
  const params = useLocalSearchParams<{ botId: string; threadId?: string; take?: string }>()
  const { botId } = params
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const browser = useStore((s) => s.browsers[botId])
  const threads = useStore((s) => s.threads)
  const threadId = params.threadId || mainThread(threads, botId)?.id
  const router = useRouter()
  // A superpower's sign-in: its window closes once the bot is signed in, and leaving gives the sign-in up.
  const signingIn = !!threadId?.startsWith('sign-in:')
  const [chosen, setChosen] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  // Above the keyboard, the bottom bar drops the room it keeps for the home indicator.
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardWillShow', () => setKeyboard(true))
    const hidden = Keyboard.addListener('keyboardWillHide', () => setKeyboard(false))
    return () => (shown.remove(), hidden.remove())
  }, [])

  const win = windowOf(browser, threadId)
  const tabs = win ? browser.tabs.filter((t) => t.windowId === win.id) : []
  // The tab that was picked; otherwise the one the bot works in.
  const tab = tabs.find((t) => t.id === chosen) ?? tabs.find((t) => t.id === win?.activeTab) ?? tabs[0]
  const tabId = tab?.id
  const driver = driverOf(win)
  const drive = driver === 'you'

  const act = async (action: string, body?: Record<string, unknown>) => {
    setError('')
    try {
      return await api('POST', `/api/bots/${botId}/browser/${action}`, { tabId, ...body })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const open = async () => {
    setOpening(true)
    await act('open', { threadId })
    setOpening(false)
  }

  // Asked to take control on the way in (the bot asked for help): done once the window is there.
  const taking = useRef(params.take === '1')
  useEffect(() => {
    if (win && taking.current) {
      taking.current = false
      control(botId, win.id, 'take')
    }
  }, [win?.id])
  // Leaving the screen, or the window, hands control back. (A view without control is not listened to.)
  useEffect(() => {
    if (!win) return
    const id = win.id
    return () => control(botId, id, 'give')
  }, [win?.id])
  useEffect(() => setChosen(null), [win?.id])
  const opened = useRef(false)
  useEffect(() => {
    if (!signingIn) return
    if (win) opened.current = true
    else if (opened.current && router.canGoBack()) router.back()
  }, [win?.id])
  useEffect(() => () => void (signingIn && api('DELETE', `/api/bots/${botId}/superpowers/${threadId!.slice('sign-in:'.length)}/login`).catch(() => {})), [])

  const { image, page } = useLivePage(botId, tabId)
  const input = (event: BrowserInput) => drive && tabId && send({ type: 'browser.input', botId, tabId, input: event })
  const press = (key: string) => (input({ kind: 'keydown', key }), input({ kind: 'keyup', key }))
  // The picture is fitted inside the box with its shape kept, so a touch is first placed within the picture.
  const shown = fit(page, box)
  const at = (e: GestureResponderEvent) => ({ x: Math.round((e.nativeEvent.locationX - shown.x) / shown.scale), y: Math.round((e.nativeEvent.locationY - shown.y) / shown.scale) })
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const name = sessionName(threads, threadId)

  return (
    // Typing into the page happens in the bar at the bottom, which, with Hand back, stays above the keyboard.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <ScreenTitle title="Browser" subtitle={bot ? `${bot.name} · ${name}` : name} />
      <View style={[styles.bar, { borderBottomColor: theme.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={!drive} hitSlop={8} onPress={() => act('back')}><Text style={[styles.icon, { color: drive ? theme.text : theme.faint }]}>‹</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Reload" disabled={!drive} hitSlop={8} onPress={() => act('reload')}><Text style={[styles.icon, { color: drive ? theme.text : theme.faint, fontSize: 20 }]}>↻</Text></Pressable>
        <TextInput
          accessibilityLabel="Address"
          style={[styles.address, { color: drive ? theme.text : theme.muted, backgroundColor: theme.side }]}
          value={address ?? (tab?.url === 'about:blank' ? '' : (tab?.url ?? ''))}
          onChangeText={setAddress}
          onBlur={() => setAddress(null)}
          onSubmitEditing={() => (address?.trim() && act('navigate', { url: address }), setAddress(null))}
          placeholder={drive ? 'Search or enter address' : ''}
          placeholderTextColor={theme.faint}
          editable={drive}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />
      </View>
      {tabs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
          {tabs.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityState={{ selected: t.id === tabId }}
              style={[styles.tab, { backgroundColor: t.id === tabId ? theme.bubble : 'transparent', borderColor: theme.border }]}
              // In control, the tab picked is where the bot carries on once it has the window back.
              onPress={() => (setChosen(t.id), drive && act('focus-tab', { tabId: t.id }))}
            >
              <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={1}>{t.title || hostOf(t.url) || 'New tab'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!!error && <Text accessibilityRole="alert" style={{ color: theme.err, fontSize: 13, padding: 10 }}>{error}</Text>}
      <View
        style={[styles.view, { backgroundColor: theme.side }]}
        onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout)}
        accessibilityLabel={tab ? `The page ${tab.title || tab.url}` : undefined}
        onStartShouldSetResponder={() => drive && !!image}
        onResponderGrant={(e) => void (touch.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, moved: false })}
        onResponderMove={(e) => {
          const last = touch.current
          if (!last) return
          const dx = last.x - e.nativeEvent.locationX
          const dy = last.y - e.nativeEvent.locationY
          // Fingers wobble a little during a tap; only a real drag scrolls the page.
          if (!last.moved && Math.hypot(dx, dy) < 8) return
          input({ kind: 'wheel', ...at(e), dx: dx / shown.scale, dy: dy / shown.scale })
          touch.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, moved: true }
        }}
        onResponderRelease={(e) => {
          const last = touch.current
          touch.current = null
          if (!last || last.moved) return
          input({ kind: 'down', ...at(e), button: 'left' })
          input({ kind: 'up', ...at(e), button: 'left' })
        }}
      >
        {image && tab && (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Image image={image} x={shown.x} y={shown.y} width={shown.width} height={shown.height} fit="fill" />
          </Canvas>
        )}
        {!win ? (
          opening || !bot ? <ActivityIndicator color={theme.muted} /> : (
            <Pressable accessibilityRole="button" style={[styles.button, { backgroundColor: theme.primary }]} onPress={open}>
              <Text style={{ color: theme.onPrimary, fontSize: 16, fontWeight: '600' }}>Open browser</Text>
            </Pressable>
          )
        ) : !image && <ActivityIndicator color={theme.muted} />}
        {/* While someone has control, the page is framed, as on the computer. */}
        {drive && image && <View pointerEvents="none" style={[styles.frame, { left: shown.x - 2, top: shown.y - 2, width: shown.width + 4, height: shown.height + 4, borderColor: theme.primary }]} />}
      </View>
      {win && bot && (
        <View style={[styles.control, { borderTopColor: theme.border, backgroundColor: win.request && !drive ? `${theme.run}22` : 'transparent', paddingBottom: drive ? 8 : Math.max(insets.bottom, 10) }]}>
          <Text style={{ flex: 1, color: driver === 'bot' && !win.request ? theme.muted : theme.text, fontSize: 14, lineHeight: 19 }}>
            {drive ? (
              <><Text style={{ fontWeight: '700' }}>You have control.</Text> {win.request ? `${win.request}, then hand back to ${bot.name}.` : `${bot.name} can’t act here until you hand it back.`}</>
            ) : win.request ? (
              <><Text style={{ fontWeight: '700' }}>{bot.name} needs you:</Text> {win.request}</>
            ) : driver === 'elsewhere' ? 'You have control on another device.' : `${bot.name} has control.`}
          </Text>
          {!drive && win.request && driver === 'bot' && (
            <Pressable accessibilityRole="button" hitSlop={6} style={[styles.button, styles.small, { borderColor: theme.border, borderWidth: 1 }]} onPress={() => control(botId, win.id, 'decline')}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Not now</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            style={[styles.button, styles.small, { backgroundColor: theme.primary }]}
            onPress={() => {
              if (drive) Keyboard.dismiss()
              control(botId, win.id, drive ? 'give' : 'take')
            }}
          >
            <Text style={{ color: theme.onPrimary, fontSize: 14, fontWeight: '600' }}>{drive ? 'Hand back' : driver === 'elsewhere' ? 'Take control here' : 'Take control'}</Text>
          </Pressable>
        </View>
      )}
      {drive && (
        <View style={[styles.typebar, { borderTopColor: theme.border, paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 8) }]}>
          <TextInput
            accessibilityLabel="Text to type into the page"
            style={[styles.address, { color: theme.text, backgroundColor: theme.side }]}
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={() => (typed ? input({ kind: 'text', text: typed }) : press('Enter'), setTyped(''))}
            placeholder="Tap a field above, then type here"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            submitBehavior="submit"
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Backspace" hitSlop={8} onPress={() => press('Backspace')}><Text style={[styles.icon, { color: theme.text, fontSize: 20 }]}>⌫</Text></Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { fontSize: 28, lineHeight: 30, width: 26, textAlign: 'center' },
  address: { flex: 1, height: 38, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  tabs: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  tab: { maxWidth: 180, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  view: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { position: 'absolute', borderWidth: 2, borderRadius: 3 },
  button: { height: 46, paddingHorizontal: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  small: { height: 36, paddingHorizontal: 14, borderRadius: 18 },
  control: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  typebar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
})
