// A page a bot showed (show_page), and diagrams and formulas, drawn in a web view of their own.
// The view is fitted to the page, which tells it how tall it is; tapped links open in Safari. The
// page cannot reach the app: all it can do is say how tall it is (see @openbot/client/page).
import { type ReactNode, useMemo, useState } from 'react'
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { PAGE_MAX_HEIGHT, pageDocument, pageHeight, readPageMessage } from '@openbot/client/page'
import { useAppearance, useTheme } from './theme'

/** The page is the only thing a view shows. A link that was tapped opens in Safari; a page cannot go anywhere by itself. */
function stay(request: ShouldStartLoadRequest) {
  if (/^(about|data|blob):/.test(request.url)) return true
  if (/^https?:/.test(request.url) && request.navigationType === 'click') void Linking.openURL(request.url)
  return false
}

function Web({ html, fit, onHeight }: { html: string; fit: boolean; onHeight?: (height: number) => void }) {
  const theme = useTheme()
  const appearance = useAppearance()
  const source = useMemo(() => ({ html: pageDocument(html, appearance) }), [html, appearance])
  const message = (e: WebViewMessageEvent) => {
    const m = readPageMessage(e.nativeEvent.data)
    if (m?.kind === 'size') onHeight?.(m.height)
  }
  return (
    <WebView
      source={source}
      originWhitelist={['*']}
      onMessage={message}
      onShouldStartLoadWithRequest={stay}
      setSupportMultipleWindows={false}
      // In the conversation the page is as tall as it is, so the conversation does the scrolling.
      scrollEnabled={!fit}
      bounces={!fit}
      showsVerticalScrollIndicator={!fit}
      showsHorizontalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      allowsLinkPreview={false}
      allowsInlineMediaPlayback
      style={{ flex: 1, backgroundColor: theme.bg }}
    />
  )
}

/** A page in the conversation, fitted to its height, with a button to open it full screen. */
export function PageView({ title, html, height }: { title: string; html: string; height: number }) {
  const theme = useTheme()
  const [measured, setMeasured] = useState<number | null>(null)
  const [full, setFull] = useState(false)
  return (
    <View style={styles.page} accessibilityLabel={title}>
      <View style={{ height: pageHeight(measured ?? height) }}>
        <Web html={html} fit onHeight={setMeasured} />
      </View>
      {measured !== null && measured > PAGE_MAX_HEIGHT && <Text style={[styles.more, { color: theme.faint }]}>The page goes on. Open it to see all of it.</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title} full screen`} hitSlop={8} onPress={() => setFull(true)} style={[styles.open, { backgroundColor: theme.raised, borderColor: theme.border }]}>
        <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 18 }}>⤢</Text>
      </Pressable>
      <Sheet title={title} visible={full} close={() => setFull(false)}>
        <Web html={html} fit={false} />
      </Sheet>
    </View>
  )
}

/** Something shown over the conversation, with its title and Done. */
export function Sheet({ title, visible, close, children }: { title: string; visible: boolean; close: () => void; children: ReactNode }) {
  const theme = useTheme()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
        <View style={[styles.sheetHead, { borderBottomColor: theme.border }]}>
          <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
          <Pressable accessibilityRole="button" hitSlop={12} onPress={close}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  )
}

/** A page a bot saved as a file, full screen. */
export function PageSheet({ title, html, close }: { title: string; html: string; close: () => void }) {
  return (
    <Sheet title={title} visible close={close}>
      <Web html={html} fit={false} />
    </Sheet>
  )
}

/** Something drawn by a script in a web view (a diagram, a formula), fitted to its height. */
export function WebBlock({ html, height }: { html: string; height: number }) {
  const [measured, setMeasured] = useState<number | null>(null)
  return (
    <View style={{ height: pageHeight(measured ?? height), marginHorizontal: -8 }}>
      <Web html={html} fit onHeight={setMeasured} />
    </View>
  )
}

const styles = StyleSheet.create({
  // The page keeps a margin of 8 of its own, so it reaches 8 past the text on each side to line up with it.
  page: { marginHorizontal: -8, marginVertical: 6 },
  more: { fontSize: 12, paddingHorizontal: 8, paddingTop: 4 },
  open: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, height: 54, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
})
