// A page a bot shows in its conversation (show_page): a chart, a dashboard, a diagram. The bot
// writes plain HTML; every app wraps it the same way before drawing it in a frame of its own:
// the app's colours as CSS variables, a sheet that makes it sit on the conversation, a policy
// that keeps it to itself, and a small script that tells the app how tall it is and, on the
// computer, which link was clicked (on the phone the web view sees link taps itself). The page
// never sees the app, and the app only listens to those messages.

export type Appearance = 'light' | 'dark'

/** A page is never drawn shorter or, in the conversation, taller than this. */
export const PAGE_MIN_HEIGHT = 60
export const PAGE_MAX_HEIGHT = 4000

export const pageHeight = (height: number) => Math.min(PAGE_MAX_HEIGHT, Math.max(PAGE_MIN_HEIGHT, Math.ceil(height) || 0))

/**
 * What a page may do. It may run scripts and load scripts, styles, fonts and pictures from the
 * public web (a chart library from a CDN, say), but it cannot send or fetch anything itself, show
 * other pages inside it, or post a form. Its data is written into it.
 */
export const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'unsafe-inline' https:",
  'img-src data: blob: https:',
  'font-src data: https:',
  'media-src data: blob: https:',
  "connect-src 'none'",
  'worker-src blob:',
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** The app's colours as a page sees them. The chart colours are checked to stay apart for colour-blind readers. */
const TOKENS: Record<Appearance, Record<string, string>> = {
  dark: {
    background: '#0c0c0d',
    foreground: '#ededef',
    card: '#151517',
    'card-foreground': '#ededef',
    muted: '#1c1c1f',
    'muted-foreground': '#9a9aa3',
    border: 'rgba(255, 255, 255, 0.1)',
    primary: '#f4f4f5',
    'primary-foreground': '#111113',
    accent: '#3987e5',
    'accent-foreground': '#ffffff',
    success: '#0ca30c',
    warning: '#fab219',
    destructive: '#d03b3b',
    info: '#3987e5',
    grid: '#232326',
    axis: '#3a3a3f',
    'code-background': '#111113',
    'chart-1': '#3987e5',
    'chart-2': '#d95926',
    'chart-3': '#199e70',
    'chart-4': '#c98500',
    'chart-5': '#d55181',
    'chart-6': '#008300',
    'chart-7': '#9085e9',
    'chart-8': '#e66767',
  },
  light: {
    background: '#ffffff',
    foreground: '#18181b',
    card: '#f7f7f8',
    'card-foreground': '#18181b',
    muted: '#efeff1',
    'muted-foreground': '#63636c',
    border: 'rgba(0, 0, 0, 0.1)',
    primary: '#18181b',
    'primary-foreground': '#ffffff',
    accent: '#2a78d6',
    'accent-foreground': '#ffffff',
    success: '#0ca30c',
    warning: '#fab219',
    destructive: '#d03b3b',
    info: '#2a78d6',
    grid: '#e8e8eb',
    axis: '#c4c4ca',
    'code-background': '#f7f7f8',
    'chart-1': '#2a78d6',
    'chart-2': '#eb6834',
    'chart-3': '#1baf7a',
    'chart-4': '#eda100',
    'chart-5': '#e87ba4',
    'chart-6': '#008300',
    'chart-7': '#6250d6',
    'chart-8': '#e34948',
  },
}

const SHARED = {
  radius: '10px',
  'font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  'font-mono': '"SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
}

/** Mermaid's colours for diagrams in a reply, so they sit on the conversation like the rest of it. */
export const DIAGRAM_THEME = (appearance: Appearance) => {
  const t = TOKENS[appearance]
  return {
    theme: 'base',
    darkMode: appearance === 'dark',
    fontFamily: SHARED['font-sans'],
    themeVariables: {
      darkMode: appearance === 'dark',
      fontFamily: SHARED['font-sans'],
      fontSize: '14px',
      background: t.background,
      mainBkg: t.card,
      primaryColor: t.card,
      primaryTextColor: t.foreground,
      primaryBorderColor: t.axis,
      secondaryColor: t.muted,
      tertiaryColor: t.background,
      lineColor: t['muted-foreground'],
      textColor: t.foreground,
      edgeLabelBackground: t.background,
      clusterBkg: t.muted,
      clusterBorder: t.axis,
      noteBkgColor: t.muted,
      noteTextColor: t.foreground,
      noteBorderColor: t.axis,
    },
  }
}

/** The variables, for the bot: what it can use in a page. */
export const PAGE_VARIABLES = [...Object.keys(TOKENS.dark), ...Object.keys(SHARED)].map((name) => `--${name}`)

const rule = (appearance: Appearance) =>
  `:root[data-theme="${appearance}"]{color-scheme:${appearance};${Object.entries(TOKENS[appearance]).map(([k, v]) => `--${k}:${v};`).join('')}}`

// The page sits on the conversation, with a small margin so rings and shadows are not cut off.
// It is fitted to its content, so it never scrolls itself (in the conversation).
const BASE =
  `:root{${Object.entries(SHARED).map(([k, v]) => `--${k}:${v};`).join('')}}${rule('dark')}${rule('light')}` +
  'html{box-sizing:border-box;padding:8px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);' +
  'font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}' +
  'html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}'

/**
 * Runs before anything of the page's own. It sets the colours (from the address, then from the
 * app), reports the page's height whenever it changes, and, in the desktop app, hands clicked
 * links to the app, which opens them in the computer's browser. On the phone a tapped link is left
 * to the web view, which tells a tap from a script and sends only taps to Safari.
 */
const BOOTSTRAP = (initial: Appearance) => `(function(){
var root=document.documentElement,last=0;
function post(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));else if(window.parent!==window)window.parent.postMessage(m,"*");}
function theme(t){if(t==="light"||t==="dark")root.setAttribute("data-theme",t);}
var m=/[#&]theme=(light|dark)/.exec(location.hash);theme(m?m[1]:${JSON.stringify(initial)});
window.addEventListener("message",function(e){var d=e.data;if(d&&d.openkumi==="theme")theme(d.appearance);});
function size(){var h=Math.ceil(root.scrollHeight>root.clientHeight?root.scrollHeight:root.getBoundingClientRect().height);if(h!==last){last=h;post({openkumi:"size",height:h});}}
if(window.ResizeObserver)new ResizeObserver(size).observe(root);
document.addEventListener("DOMContentLoaded",size);window.addEventListener("load",size);
if(window.ReactNativeWebView)return;
function open(u){try{u=new URL(u,location.href);}catch(x){return;}if(/^https?:$/.test(u.protocol))post({openkumi:"open",url:u.href});}
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href");if(h.charAt(0)==="#")return;e.preventDefault();open(h);},true);
window.open=function(u){open(String(u));return null;};
})();`

/** Wraps a bot's page for drawing. `appearance` is used until the app says otherwise (see themeMessage). */
export function pageDocument(html: string, appearance: Appearance = 'dark'): string {
  const head =
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">` +
    (/<meta\s[^>]*name\s*=\s*["']?viewport/i.test(html) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">') +
    `<style id="openkumi-base">${BASE}</style>` +
    `<script>${BOOTSTRAP(appearance)}</script>`
  // Put first in <head> (so before any script or style of the page's own), but after a doctype,
  // which has to stay first or the page is drawn in the old "quirks" way.
  const scan = html.slice(0, 8192).replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  const end = scan.search(/<(script|style|body)\b/i)
  const before = end === -1 ? scan : scan.slice(0, end)
  const at = /<head(\s[^>]*)?>/i.exec(before) ?? /<html(\s[^>]*)?>/i.exec(before) ?? /^\s*<!doctype[^>]*>/i.exec(before)
  const doctype = /^\s*<!doctype/i.test(scan) ? '' : '<!doctype html>'
  if (!at) return `${doctype}${head}${html}`
  const cut = at.index + at[0].length
  return `${doctype}${html.slice(0, cut)}${head}${html.slice(cut)}`
}

/** Tells a page that is already showing to change its colours. */
export const themeMessage = (appearance: Appearance) => ({ openkumi: 'theme', appearance })

export type PageMessage = { kind: 'size'; height: number } | { kind: 'open'; url: string }

/** One of the page's messages, or null for anything else. The phone receives them as JSON text. */
export function readPageMessage(data: unknown): PageMessage | null {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (typeof data !== 'object' || data === null) return null
  const { openkumi, height, url } = data as Record<string, unknown>
  if (openkumi === 'size' && typeof height === 'number' && Number.isFinite(height) && height > 0) return { kind: 'size', height }
  if (openkumi === 'open' && typeof url === 'string' && /^https?:\/\//i.test(url)) return { kind: 'open', url }
  return null
}
