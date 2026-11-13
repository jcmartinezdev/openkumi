// Replies as they are drawn on the phone: Markdown, with code in the same colours as on the
// computer (and a button to copy it), tables that scroll sideways, and ```mermaid diagrams and
// formulas drawn in a web view.
import { type ReactNode, createContext, memo, useContext, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native'
import MarkdownDisplay, { type ASTNode, type RenderRules } from 'react-native-markdown-display'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { CODE_COLORS, highlightRuns, languageName } from '@openkumi/client/highlight'
import { fenceMath, workspaceLink } from '@openkumi/client/markdown'
import { DIAGRAM_THEME } from '@openkumi/client/page'
import { WebBlock } from './PageView'
import { useTextScale } from './prefs'
import { type Theme, useAppearance, useTheme } from './theme'

type Appearance = 'light' | 'dark'

const MONO = 'Menlo'

/** Puts text on the clipboard, with a tap to say so. */
export async function copy(text: string) {
  await Clipboard.setStringAsync(text)
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
}

function CopyButton({ text, theme }: { text: string; theme: Theme }) {
  const [copied, setCopied] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy code"
      hitSlop={10}
      onPress={() => copy(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
    >
      <Text style={{ color: theme.muted, fontSize: 13 }}>{copied ? 'Copied' : 'Copy'}</Text>
    </Pressable>
  )
}

/**
 * Content wider than the screen (a table, a line of code), scrolled sideways on its own. It flashes
 * its scroll bar once when there is more to see.
 */
function SideScroll({ children, style, contentContainerStyle }: { children: ReactNode; style?: object; contentContainerStyle?: object }) {
  const view = useRef<ScrollViewInstance>(null)
  const size = useRef({ frame: 0, content: 0, shown: false })
  const check = () => {
    const s = size.current
    if (s.shown || !s.frame || s.content <= s.frame + 1) return
    s.shown = true
    view.current?.flashScrollIndicators()
  }
  return (
    <ScrollView
      ref={view}
      horizontal
      style={style}
      contentContainerStyle={contentContainerStyle}
      onLayout={(e) => ((size.current.frame = e.nativeEvent.layout.width), check())}
      onContentSizeChange={(width) => ((size.current.content = width), check())}
    >
      {children}
    </ScrollView>
  )
}

const Code = memo(function Code({ lang, code, theme, appearance, scale, plain }: { lang: string; code: string; theme: Theme; appearance: Appearance; scale: number; plain?: boolean }) {
  const runs = useMemo(() => (plain ? null : highlightRuns(code, lang)), [code, lang, plain])
  const colors = CODE_COLORS[appearance]
  return (
    <View style={[styles.code, { backgroundColor: theme.side, borderColor: theme.border }]}>
      <View style={[styles.codeHead, { borderBottomColor: theme.border }]}>
        <Text style={{ flex: 1, color: theme.faint, fontSize: 12 }} numberOfLines={1}>{languageName(lang)}</Text>
        <CopyButton text={code} theme={theme} />
      </View>
      <SideScroll contentContainerStyle={styles.codeBody}>
        <Text selectable style={[styles.codeText, { color: theme.text, fontSize: 13 * scale, lineHeight: 19 * scale }]}>
          {runs ? runs.map((run, i) => (run.kind ? <Text key={i} style={{ color: colors[run.kind], fontStyle: run.kind === 'comment' ? 'italic' : 'normal' }}>{run.text}</Text> : run.text)) : code}
        </Text>
      </SideScroll>
    </View>
  )
})

/** Mermaid and KaTeX come from the web, at the versions the computer's app uses, into the web view only. */
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js'
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.47/dist'

/** A value written into a script in a page: "<" is written out so nothing in it can end the script. */
const literal = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

const diagramPage = (code: string, dark: boolean) =>
  `<style>#d{display:flex;justify-content:center}#d svg{max-width:100%;height:auto}</style><div id="d"></div>` +
  `<script src="${MERMAID}" onerror="document.getElementById('d').textContent='The diagram could not be drawn: the phone is offline.'"></script>` +
  `<script>if(window.mermaid){mermaid.initialize(Object.assign({startOnLoad:false,securityLevel:"strict"},${literal(DIAGRAM_THEME(dark ? 'dark' : 'light'))}));` +
  `mermaid.render("diagram",${literal(code)}).then(function(r){d.innerHTML=r.svg}).catch(function(){d.textContent="This diagram could not be drawn."})}</script>`

const formulaPage = (tex: string) =>
  `<link rel="stylesheet" href="${KATEX}/katex.min.css"><style>#f{overflow-x:auto;overflow-y:hidden;text-align:center}</style><div id="f"></div>` +
  `<script src="${KATEX}/katex.min.js" onerror="document.getElementById('f').textContent=${literal(tex).replace(/"/g, '&quot;')}"></script>` +
  `<script>if(window.katex)katex.render(${literal(tex)},f,{displayMode:true,throwOnError:false})</script>`

function Diagram({ code, theme, appearance }: { code: string; theme: Theme; appearance: Appearance }) {
  const [source, setSource] = useState(false)
  const html = useMemo(() => diagramPage(code, appearance === 'dark'), [code, appearance])
  return (
    <View style={[styles.code, { backgroundColor: theme.bg, borderColor: theme.border }]}>
      <View style={[styles.codeHead, { borderBottomColor: theme.border, backgroundColor: theme.side }]}>
        <Text style={{ flex: 1, color: theme.faint, fontSize: 12 }}>Diagram</Text>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setSource(!source)}>
          <Text style={{ color: theme.muted, fontSize: 13 }}>{source ? 'Diagram' : 'Code'}</Text>
        </Pressable>
        <CopyButton text={code} theme={theme} />
      </View>
      {source ? (
        <SideScroll contentContainerStyle={styles.codeBody}>
          <Text selectable style={[styles.codeText, { color: theme.text }]}>{code}</Text>
        </SideScroll>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <WebBlock html={html} height={200} />
        </View>
      )}
    </View>
  )
}

/** Widths of a table's columns, from the longest text in each, so a wide table scrolls instead of squeezing. */
const widths = new WeakMap<ASTNode, number[]>()
function columnWidths(table: ASTNode): number[] {
  const known = widths.get(table)
  if (known) return known
  const text = (node: ASTNode): string => (node.content ?? '') + node.children.map(text).join('')
  const longest: number[] = []
  const walk = (node: ASTNode) => {
    if (node.type === 'th' || node.type === 'td') longest[node.index] = Math.max(longest[node.index] ?? 0, text(node).length)
    else node.children.forEach(walk)
  }
  walk(table)
  const found = longest.map((chars) => Math.min(260, Math.max(64, chars * 8 + 24)))
  widths.set(table, found)
  return found
}

/** `scale` is the message text size chosen in Settings › Appearance. */
function rules(theme: Theme, appearance: Appearance, live: boolean, scale: number): RenderRules {
  const cell = (node: ASTNode, children: React.ReactNode[], parents: ASTNode[], head: boolean) => {
    const table = parents.find((p) => p.type === 'table')
    const width = table ? columnWidths(table)[node.index] : undefined
    return (
      <View key={node.key} style={[styles.cell, { width, borderColor: theme.border }, head && { backgroundColor: theme.side }]}>
        {head ? <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 * scale }}>{children}</Text> : children}
      </View>
    )
  }
  const fence = (node: ASTNode) => {
    // The fence's info line ("```ts"), which the library keeps but does not declare.
    const lang = ((node as ASTNode & { sourceInfo?: string }).sourceInfo ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const code = (node.content ?? '').replace(/\n$/, '')
    // While a reply is being written, its diagrams and formulas wait until it is done.
    if (!live && lang === 'mermaid') return <Diagram key={node.key} code={code} theme={theme} appearance={appearance} />
    if (!live && lang === 'math') return <View key={node.key} style={{ marginVertical: 4 }}><WebBlock html={formulaPage(code)} height={60} /></View>
    return <Code key={node.key} lang={lang} code={code} theme={theme} appearance={appearance} scale={scale} plain={live} />
  }
  return {
    fence,
    code_block: (node) => <Code key={node.key} lang="" code={(node.content ?? '').replace(/\n$/, '')} theme={theme} appearance={appearance} scale={scale} plain />,
    table: (node, children) => (
      <SideScroll key={node.key} style={styles.tableScroll}>
        <View style={[styles.table, { borderColor: theme.border }]}>{children}</View>
      </SideScroll>
    ),
    tr: (node, children) => <View key={node.key} style={styles.row}>{children}</View>,
    th: (node, children, parents) => cell(node, children, parents, true),
    td: (node, children, parents) => cell(node, children, parents, false),
  }
}

const look = (theme: Theme, scale: number) =>
  StyleSheet.create({
    body: { color: theme.text, fontSize: 16 * scale, lineHeight: 23 * scale },
    // Text in a table is a little smaller, so more of it fits across.
    th: { fontSize: 15 * scale, lineHeight: 21 * scale },
    td: { fontSize: 15 * scale, lineHeight: 21 * scale },
    paragraph: { marginTop: 0, marginBottom: 10 },
    heading1: { fontSize: 20 * scale, fontWeight: '600', marginTop: 10, marginBottom: 6 },
    heading2: { fontSize: 18 * scale, fontWeight: '600', marginTop: 10, marginBottom: 6 },
    heading3: { fontSize: 16 * scale, fontWeight: '600', marginTop: 8, marginBottom: 4 },
    code_inline: { backgroundColor: theme.bubble, color: theme.text, fontFamily: MONO, fontSize: 14 * scale },
    blockquote: { backgroundColor: 'transparent', borderLeftColor: theme.border, borderLeftWidth: 2, paddingHorizontal: 10, marginLeft: 0 },
    link: { color: theme.text, textDecorationLine: 'underline' },
    hr: { backgroundColor: theme.border, marginVertical: 12 },
    bullet_list_icon: { color: theme.muted },
    ordered_list_icon: { color: theme.muted },
  })

/**
 * Opens a file of the bot's workspace that a reply links to ("files/report.html"). Given by the
 * conversation the reply is in.
 */
export const FileLinks = createContext<((path: string) => void) | null>(null)

/** `live` is for a reply that is still being written. */
export const Markdown = memo(function Markdown({ text, live = false }: { text: string; live?: boolean }) {
  const theme = useTheme()
  const appearance = useAppearance()
  const scale = useTextScale()
  const style = useMemo(() => look(theme, scale), [theme, scale])
  const drawn = useMemo(() => rules(theme, appearance, live, scale), [theme, appearance, live, scale])
  const openFile = useContext(FileLinks)
  // A link to one of the bot's files opens it here; any other link opens in Safari.
  const press = (url: string) => {
    const path = openFile ? workspaceLink(url) : null
    if (!path) return true
    openFile!(path)
    return false
  }
  return <MarkdownDisplay style={style} rules={drawn} onLinkPress={press}>{fenceMath(text)}</MarkdownDisplay>
})

const styles = StyleSheet.create({
  code: { marginVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden' },
  codeHead: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 34, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  codeBody: { paddingHorizontal: 12, paddingVertical: 10 },
  codeText: { fontFamily: MONO, fontSize: 13, lineHeight: 19 },
  tableScroll: { marginVertical: 6 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
})
