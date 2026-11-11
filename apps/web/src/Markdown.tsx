// Replies as they are drawn: Markdown, with code in colour (and a button to copy it), diagrams
// from ```mermaid blocks, formulas, and tables that scroll sideways instead of squeezing.
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Lexer, Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked'
import { memo, useEffect, useMemo, useState } from 'react'
import { highlight, languageName, languageOf } from '@openbot/client/highlight'
import { fenceMath } from '@openbot/client/markdown'
import { DIAGRAM_THEME } from '@openbot/client/page'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { PageFrame } from './PageFrame'
import { useAppearance } from './prefs'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const tex = (source: string, displayMode: boolean) => katex.renderToString(source, { displayMode, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' })

/**
 * $x$ and \(x\) within a line. A dollar sign only opens a formula when something other than a
 * space follows it, and only closes one after something other than a space and before anything
 * other than a digit, so "it costs $5 and $10" stays as it is.
 */
const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => {
    const at = src.search(/\$|\\\(/)
    return at === -1 ? undefined : at
  },
  tokenizer(src) {
    const match = /^\$(?=[^\s$])((?:\\.|[^$\\\n])+?)(?<=[^\s\\])\$(?!\d)/.exec(src) ?? /^\\\(((?:\\.|[^\\\n])+?)\\\)/.exec(src)
    if (match) return { type: 'inlineMath', raw: match[0], text: match[1] }
  },
  renderer: (token) => tex(token.text, false),
}

const MARKDOWN = { gfm: true, breaks: true }
const md = new Marked(MARKDOWN, { extensions: [inlineMath] })

const toHtml = (text: string) =>
  DOMPurify.sanitize(md.parse(text) as string)
    // Wide tables scroll on their own instead of squeezing their columns.
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')

/**
 * Text as it is drawn, block by block (a paragraph, a list, a code block…). While a reply is
 * still being written (`live`), the blocks already written stay exactly as they are on the page
 * and only the last one is worked out again as more text arrives, so a long reply costs the same
 * to keep up with at its end as at its start; diagrams and colours wait until a block is complete.
 */
export const Markdown = memo(function Markdown({ text, live }: { text: string; live?: boolean }) {
  const blocks = useMemo(() => new Lexer(MARKDOWN).blockTokens(fenceMath(text.replace(/\r\n?/g, '\n'))).filter((token) => token.type !== 'space'), [text])
  return (
    <div className="md">
      {blocks.map((token, i) =>
        token.type === 'code' ? (
          <CodeBlock key={i} lang={(token as Tokens.Code).lang ?? ''} code={(token as Tokens.Code).text} done={!live || i < blocks.length - 1} />
        ) : (
          <Piece key={i} raw={token.raw} />
        ),
      )}
    </div>
  )
})

const Piece = memo(function Piece({ raw }: { raw: string }) {
  const html = useMemo(() => toHtml(raw), [raw])
  return <div className="md-piece" dangerouslySetInnerHTML={{ __html: html }} />
})

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const done = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(done)
  }, [copied])
  return (
    <button className="icon small" title={copied ? 'Copied' : label} aria-label={copied ? 'Copied' : label} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})}>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

function CodeBlock({ lang, code, done }: { lang: string; code: string; done: boolean }) {
  const name = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (done && name === 'mermaid') return <Diagram code={code} />
  if (done && name === 'math') return <Formula source={code} />
  return <Code name={name} code={code} done={done} />
}

function Code({ name, code, done }: { name: string; code: string; done: boolean }) {
  const html = useMemo(() => (done && languageOf(name) ? highlight(code, name) : null), [code, name, done])
  // An HTML page in a reply can be looked at, not only read.
  const [preview, setPreview] = useState(false)
  const page = done && (name === 'html' || name === 'svg' || (name === 'xml' && /^\s*<svg\b/i.test(code)))
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{languageName(name)}</span>
        {page && (
          <button className="pill link" onClick={() => setPreview(!preview)}>
            {preview ? 'Code' : 'Preview'}
          </button>
        )}
        <CopyButton text={code} label="Copy code" />
      </div>
      {preview ? (
        <PageFrame title="Preview" html={code} height={320} />
      ) : (
        <pre>{html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}</pre>
      )}
    </div>
  )
}

function Formula({ source }: { source: string }) {
  const html = useMemo(() => tex(source, true), [source])
  return <div className="formula" dangerouslySetInnerHTML={{ __html: html }} />
}

// ---- diagrams

/** Drawn diagrams, by colours and source, so a reply that is drawn again (finished, or scrolled back to) does not wait. */
const drawn = new Map<string, string | null>()
let queue: Promise<unknown> = Promise.resolve()
let count = 0

/** Draws a diagram as SVG, or null when its source is not a diagram Mermaid understands. Mermaid is loaded the first time. */
function draw(code: string, dark: boolean): Promise<string | null> {
  const key = `${dark}\n${code}`
  if (drawn.has(key)) return Promise.resolve(drawn.get(key)!)
  // Mermaid draws one diagram at a time.
  const job = queue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...(DIAGRAM_THEME(dark ? 'dark' : 'light') as object) })
    if (!(await mermaid.parse(code, { suppressErrors: true }))) return null
    const { svg } = await mermaid.render(`diagram-${++count}`, code)
    return svg
  })
  queue = job.catch(() => {})
  return job.then(
    (svg) => (drawn.set(key, svg), svg),
    () => (drawn.set(key, null), null),
  )
}

function Diagram({ code }: { code: string }) {
  const dark = useAppearance() === 'dark'
  const key = `${dark}\n${code}`
  const [result, setResult] = useState<{ key: string; svg: string | null } | null>(() => (drawn.has(key) ? { key, svg: drawn.get(key)! } : null))
  const [source, setSource] = useState(false)
  const [full, setFull] = useState(false)
  useEffect(() => {
    let current = true
    draw(code, dark).then((svg) => current && setResult({ key, svg }))
    return () => void (current = false)
  }, [key])
  const svg = result?.key === key ? result.svg : undefined
  // Not a diagram after all: shown as the code it is.
  if (svg === null) return <Code name="mermaid" code={code} done />
  return (
    <div className="code-block diagram">
      <div className="code-head">
        <span className="code-lang">Diagram</span>
        <button className="pill link" onClick={() => setSource(!source)}>{source ? 'Diagram' : 'Code'}</button>
        <button className="icon small" title="Open full size" aria-label="Open the diagram full size" disabled={!svg} onClick={() => setFull(true)}>
          <Icon name="expand" size={14} />
        </button>
        <CopyButton text={code} label="Copy code" />
      </div>
      {source ? (
        <pre><code>{code}</code></pre>
      ) : svg ? (
        <div className="diagram-body" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="diagram-body waiting"><span className="spinner" /></div>
      )}
      {full && svg && (
        <Dialog title="Diagram" close={() => setFull(false)} full>
          <div className="diagram-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </Dialog>
      )}
    </div>
  )
}
