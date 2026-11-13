// A small live view of a bot's browser that floats over its chat while one of its threads browses,
// as on the computer. Tapping it opens that window on the browser screen; when the bot asks for help
// in it, it says so, and tapping it takes control on the way in.
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Canvas, Image } from '@shopify/react-native-skia'
import { useIsFocused } from 'expo-router'
import type { BrowserState } from '@openkumi/shared'
import { driverOf, sessionName, windowOf } from '@openkumi/client/browser'
import { useStore } from '@openkumi/client/store'
import { Glyph } from './icons'
import { fit, useLivePage } from './LivePage'
import { useTheme } from './theme'

/** Threads whose floating view was closed: it stays closed until the bot asks for help in them. */
const dismissed = new Set<string>()
const PICTURE = { width: 168, height: 105 }

export function BrowserPip({ botId, open }: { botId: string; open: (threadId: string, take: boolean) => void }) {
  const theme = useTheme()
  const focused = useIsFocused()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const browser = useStore((s) => s.browsers[botId])
  const threads = useStore((s) => s.threads)
  const [threadId, setThreadId] = useState<string | null>(null)

  // Undefined until the chat has shown once; null while the bot has no browser running.
  const seen = useRef<BrowserState | null | undefined>(undefined)
  useEffect(() => {
    const first = seen.current === undefined
    const was = seen.current
    seen.current = browser ?? null
    for (const win of browser?.windows ?? []) {
      if (!win.threadId) continue
      const before = was?.windows?.find((w) => w.id === win.id)
      const asked = !!win.request && win.request !== before?.request
      // What the bot did before the chat was opened is not news; a request still waiting is.
      const used = !first && win.usedAt > (before?.usedAt ?? 0)
      if (asked) dismissed.delete(win.threadId)
      else if (!used || dismissed.has(win.threadId)) continue
      const id = win.threadId
      // One that is showing stays, unless the bot asks for help in another.
      setThreadId((current) => (current && !asked && windowOf(browser, current) ? current : id))
    }
  }, [browser])

  const win = windowOf(browser, threadId ?? undefined)
  const tab = win && browser.tabs.find((t) => t.id === win.activeTab)
  // Only watched while the chat is showing: the browser screen on top has its own view.
  const { image, page } = useLivePage(botId, tab?.id, focused && !!win)
  if (!win || !threadId || !focused || !bot) return null
  const asking = !!win.request && driverOf(win) !== 'you'
  const shown = fit(page, PICTURE)
  const name = sessionName(threads, threadId)

  return (
    <View style={styles.pip}>
      <Pressable
        style={[styles.card, { backgroundColor: theme.raised, borderColor: asking ? theme.run : theme.border }]}
        accessibilityRole="button"
        accessibilityLabel={asking ? `${bot.name} needs you: ${win.request}. Take control` : `${bot.name}’s browser, ${name}`}
        onPress={() => open(threadId, asking)}
      >
        <View style={[styles.picture, { backgroundColor: theme.side }]}>
          {image && (
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Image image={image} x={shown.x} y={shown.y} width={shown.width} height={shown.height} fit="fill" />
            </Canvas>
          )}
        </View>
        <Text style={[styles.label, { color: asking ? theme.text : theme.muted, fontWeight: asking ? '600' : '400' }]} numberOfLines={1}>
          {asking ? `${bot.name} needs you` : name}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the floating browser"
        hitSlop={10}
        style={[styles.close, { backgroundColor: theme.raised }]}
        onPress={() => (dismissed.add(threadId), setThreadId(null))}
      >
        <Glyph name="x" size={12} color={theme.text} weight={2.2} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  // The shadow is on the outside: a view that clips its corners clips its shadow too.
  pip: { position: 'absolute', top: 8, right: 12, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  card: { width: PICTURE.width + 2, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  picture: { width: PICTURE.width, height: PICTURE.height },
  label: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 5 },
  close: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', opacity: 0.9 },
})
