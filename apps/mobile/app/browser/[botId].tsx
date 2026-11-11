// A bot's own browser, live: watch what it is doing, and tap, scroll and type into the page.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, type GestureResponderEvent, type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Canvas, Image, type SkImage, Skia } from '@shopify/react-native-skia'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BrowserInput } from '@openbot/shared'
import { api, send, useStore } from '@openbot/client/store'
import { ScreenTitle } from '../../src/ScreenTitle'
import { watch } from '../../src/session'
import { useTheme } from '../../src/theme'

export default function Browser() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { botId, threadId } = useLocalSearchParams<{ botId: string; threadId?: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const browser = useStore((s) => s.browsers[botId])
  const connected = useStore((s) => s.connected)
  const [chosen, setChosen] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [image, setImage] = useState<SkImage | null>(null)
  /** The size of the page in its own units, which taps are sent in. */
  const page = useRef({ width: 1280, height: 800 })
  const [box, setBox] = useState({ width: 0, height: 0 })

  const running = !!browser?.running
  const tabs = running ? browser.tabs : []
  // The tab that was picked; otherwise the one the chat's bot is using; otherwise the first.
  const tab = tabs.find((t) => t.id === chosen) ?? tabs.find((t) => threadId && t.threadId === threadId) ?? tabs[0]
  const tabId = tab?.id

  const act = async (action: string, body?: Record<string, unknown>) => {
    setError('')
    try {
      return await api('POST', `/api/bots/${botId}/browser/${action}`, { tabId, ...body })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Pictures of the page arrive as JPEGs; the newest is decoded and shown, and the one before it let go.
  useEffect(() => {
    if (!tabId || !connected) return
    setImage(null)
    let last: SkImage | null = null
    const off = watch(`${botId}:${tabId}`, (picture) => {
      // The JPEG is a slice of a longer message; it is copied out so the decoder gets it and nothing else.
      const next = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(picture.jpeg.slice()))
      if (!next) return
      page.current = { width: picture.width, height: picture.height }
      setImage(next)
      last?.dispose()
      last = next
    })
    send({ type: 'browser.subscribe', botId, tabId })
    return () => {
      off()
      send({ type: 'browser.unsubscribe', botId, tabId })
    }
  }, [botId, tabId, connected])

  const input = (event: BrowserInput) => tabId && send({ type: 'browser.input', botId, tabId, input: event })
  // The picture is fitted inside the box with its shape kept, so a touch is first placed within the picture.
  const scale = Math.min(box.width / page.current.width, box.height / page.current.height) || 1
  const shown = { width: page.current.width * scale, height: page.current.height * scale }
  const origin = { x: (box.width - shown.width) / 2, y: (box.height - shown.height) / 2 }
  const at = (e: GestureResponderEvent) => ({ x: Math.round((e.nativeEvent.locationX - origin.x) / scale), y: Math.round((e.nativeEvent.locationY - origin.y) / scale) })
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  return (
    <View style={{ flex: 1 }}>
      <ScreenTitle title="Browser" subtitle={bot?.name} />
      <View style={[styles.bar, { borderBottomColor: theme.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={!tab} hitSlop={8} onPress={() => act('back')}><Text style={[styles.icon, { color: tab ? theme.text : theme.faint }]}>‹</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Reload" disabled={!tab} hitSlop={8} onPress={() => act('reload')}><Text style={[styles.icon, { color: tab ? theme.text : theme.faint, fontSize: 20 }]}>↻</Text></Pressable>
        <TextInput
          accessibilityLabel="Address"
          style={[styles.address, { color: theme.text, backgroundColor: theme.side }]}
          value={address ?? (tab?.url === 'about:blank' ? '' : (tab?.url ?? ''))}
          onChangeText={setAddress}
          onBlur={() => setAddress(null)}
          onSubmitEditing={() => (address?.trim() && act('navigate', { url: address }), setAddress(null))}
          placeholder="Search or enter address"
          placeholderTextColor={theme.faint}
          editable={!!tab}
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
            <Pressable key={t.id} accessibilityRole="button" style={[styles.tab, { backgroundColor: t.id === tabId ? theme.bubble : 'transparent', borderColor: theme.border }]} onPress={() => setChosen(t.id)}>
              <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={1}>{t.title || t.url || 'New tab'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!!error && <Text accessibilityRole="alert" style={{ color: theme.err, fontSize: 13, padding: 10 }}>{error}</Text>}
      <View
        style={[styles.view, { backgroundColor: theme.side }]}
        onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout)}
        accessibilityLabel={tab ? `The page ${tab.title || tab.url}` : undefined}
        onStartShouldSetResponder={() => running && !!image}
        onResponderGrant={(e) => void (touch.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, moved: false })}
        onResponderMove={(e) => {
          const last = touch.current
          if (!last) return
          const dx = last.x - e.nativeEvent.locationX
          const dy = last.y - e.nativeEvent.locationY
          // Fingers wobble a little during a tap; only a real drag scrolls the page.
          if (!last.moved && Math.hypot(dx, dy) < 8) return
          input({ kind: 'wheel', ...at(e), dx: dx / scale, dy: dy / scale })
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
        {image && running && (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Image image={image} x={origin.x} y={origin.y} width={shown.width} height={shown.height} fit="fill" />
          </Canvas>
        )}
        {!running ? (
          starting ? <ActivityIndicator color={theme.muted} /> : (
            <Pressable accessibilityRole="button" style={[styles.start, { backgroundColor: theme.primary }]} onPress={async () => (setStarting(true), await act('start'), setStarting(false))}>
              <Text style={{ color: theme.onPrimary, fontSize: 16, fontWeight: '600' }}>Start browser</Text>
            </Pressable>
          )
        ) : !image && <ActivityIndicator color={theme.muted} />}
      </View>
      <View style={[styles.typebar, { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TextInput
          accessibilityLabel="Text to type into the page"
          style={[styles.address, { color: theme.text, backgroundColor: theme.side }]}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={() => (typed ? input({ kind: 'text', text: typed }) : (input({ kind: 'keydown', key: 'Enter' }), input({ kind: 'keyup', key: 'Enter' })), setTyped(''))}
          placeholder="Tap a field above, then type here"
          placeholderTextColor={theme.faint}
          editable={running}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          submitBehavior="submit"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Backspace" disabled={!running} hitSlop={8} onPress={() => (input({ kind: 'keydown', key: 'Backspace' }), input({ kind: 'keyup', key: 'Backspace' }))}><Text style={[styles.icon, { color: theme.text, fontSize: 20 }]}>⌫</Text></Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { fontSize: 28, lineHeight: 30, width: 26, textAlign: 'center' },
  address: { flex: 1, height: 38, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  tabs: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  tab: { maxWidth: 180, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  view: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  start: { height: 46, paddingHorizontal: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typebar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
})
