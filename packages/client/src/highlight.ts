// Colours for code in a reply, worked out the same way in every app. The desktop window draws the
// HTML that highlight.js makes; the phone, which cannot draw HTML, gets the same as runs of text.
import hljs from 'highlight.js/lib/common'

/** Longer code is shown plain: highlighting it would hold up the reply for little gain. */
const MAX = 60_000

/** The language a code block names, when it is one that can be highlighted. */
export function languageOf(lang: string): string | null {
  const name = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return name && hljs.getLanguage(name) ? name : null
}

/** The code as highlighted HTML (escaped, with <span class="hljs-…"> around each part), or null. */
export function highlight(code: string, lang: string): string | null {
  const language = languageOf(lang)
  if (!language || code.length > MAX) return null
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

/** Names of languages as people write them. */
const NAMES: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', py: 'Python', python: 'Python',
  sh: 'Shell', bash: 'Bash', zsh: 'Zsh', shell: 'Shell', console: 'Terminal', json: 'JSON', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS',
  sql: 'SQL', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', go: 'Go', rust: 'Rust', rs: 'Rust', java: 'Java', kotlin: 'Kotlin',
  swift: 'Swift', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', rb: 'Ruby', ruby: 'Ruby', php: 'PHP', diff: 'Diff', toml: 'TOML', ini: 'INI',
  dockerfile: 'Dockerfile', graphql: 'GraphQL', lua: 'Lua', r: 'R', perl: 'Perl', makefile: 'Makefile', text: 'Text', txt: 'Text', plaintext: 'Text',
}

/** What to call the language a code block names, e.g. "TypeScript" for "ts". */
export const languageName = (lang: string) => {
  const name = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return NAMES[name] ?? name
}

/** What a run of highlighted code is, by the colour it gets (see CODE_COLORS). */
export type CodeKind = keyof typeof CODE_COLORS.dark

const KINDS: Record<string, CodeKind> = {
  keyword: 'keyword', doctag: 'keyword', 'template-tag': 'keyword',
  string: 'string', regexp: 'string', char: 'string', 'meta-string': 'string',
  number: 'number', literal: 'number', symbol: 'number', bullet: 'number', link: 'number',
  comment: 'comment', quote: 'comment',
  title: 'title', section: 'title',
  type: 'type', built_in: 'type', variable: 'type', 'template-variable': 'type',
  attr: 'attr', attribute: 'attr', property: 'attr', meta: 'attr', 'selector-id': 'attr', 'selector-class': 'attr', 'selector-attr': 'attr', 'selector-pseudo': 'attr',
  tag: 'tag', name: 'tag', 'selector-tag': 'tag',
  addition: 'addition', deletion: 'deletion',
}

/** The colour of each kind, in the dark and the light dress. The desktop stylesheet uses the same ones. */
export const CODE_COLORS = {
  dark: { keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b8b94', title: '#d2a8ff', type: '#ffa657', attr: '#79c0ff', tag: '#7ee787', addition: '#7ee787', deletion: '#ffa198' },
  light: { keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', title: '#8250df', type: '#953800', attr: '#0550ae', tag: '#116329', addition: '#116329', deletion: '#82071e' },
} as const

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const unescape = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e])

/** The code as runs of text, each with its kind (null for plain), or null when it cannot be highlighted. */
export function highlightRuns(code: string, lang: string): { text: string; kind: CodeKind | null }[] | null {
  const html = highlight(code, lang)
  if (html === null) return null
  const runs: { text: string; kind: CodeKind | null }[] = []
  // highlight.js only ever writes escaped text and nested <span class="…"> … </span>.
  const open: (CodeKind | null)[] = []
  for (const [, tag, classes, text] of html.matchAll(/<(\/?)span(?: class="([^"]*)")?>|([^<]+)/g)) {
    if (text !== undefined) {
      const kind = open.findLast((k) => k !== null) ?? null
      const last = runs.at(-1)
      if (last && last.kind === kind) last.text += unescape(text)
      else runs.push({ text: unescape(text), kind })
    } else if (tag) open.pop()
    else open.push(KINDS[/hljs-([\w-]+)/.exec(classes ?? '')?.[1] ?? ''] ?? null)
  }
  return runs
}
