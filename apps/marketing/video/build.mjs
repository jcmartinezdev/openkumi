// Puts the film together as one page (scripts/video.mjs films it). The page holds everything it
// shows, drawn from the same sources as the app and the website, so the film follows them when they
// change: the mascots from @openkumi/client/mascot and src/lib/brand.ts, the marks of what bots run
// on from @openkumi/client/marks, the superpowers' icons and names from apps/server/superpowers,
// and the app as it looks from src/assets/screenshots. What moves, and when, is in film.js.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { drawMascot, signColors } from '@openkumi/client/mascot'
import { markOf } from '@openkumi/client/marks'
import { KUMI, drawKumi } from '../src/lib/brand.ts'

const here = import.meta.dirname
const site = path.resolve(here, '..')
const root = path.resolve(site, '../..')

/**
 * The bots in the film, dressed as the website's crew (the `crew` list at the top of
 * src/pages/index.astro) and as the bots in the screenshots (scripts/screenshots.mjs).
 */
const CREW = [
  { id: 'kumi', name: 'Kumi', emoji: '🤖', look: KUMI },
  { id: 'researcher', name: 'Researcher', emoji: '🔬', look: { creature: 'cat', color: 'periwinkle', hat: 'grad', extra: 'glasses', clothes: 'navy' } },
  { id: 'inbox', name: 'Inbox', emoji: '📬', look: { creature: 'bunny', color: 'lemon', hat: 'cap', extra: 'none', clothes: 'teal' } },
  { id: 'chef', name: 'Chef', emoji: '🍳', look: { creature: 'blob', color: 'tangerine', hat: 'chef', extra: 'bowtie', clothes: 'red' } },
  { id: 'travel', name: 'Travel', emoji: '✈️', look: { creature: 'bug', color: 'mint', hat: 'beanie', extra: 'scarf', clothes: 'purple' } },
  { id: 'money', name: 'Money', emoji: '💰', look: { creature: 'bug', color: 'lemon', hat: 'top', extra: 'bowtie', clothes: 'charcoal' } },
  { id: 'coach', name: 'Coach', emoji: '🏃', look: { creature: 'bunny', color: 'berry', hat: 'headband', extra: 'none', clothes: 'teal' } },
  { id: 'ideas', name: 'Ideas', emoji: '🧠', look: { creature: 'blob', color: 'periwinkle', hat: 'wizard', extra: 'none', clothes: 'purple' } },
]

/** The same mascot appears more than once in the film, and each copy's gradient needs an id of its own: film.js swaps this for one. */
const ID = '__ID__'

/**
 * Kumi, whole, with the robot on its sign moved inside its body, so it moves with the body when
 * the film squashes it. (brand.ts draws the robot after the body, which is the same picture standing still.)
 */
function kumiWhole() {
  const plain = drawMascot(KUMI, '', { id: ID, bare: true })
  const robot = drawKumi(ID).body.slice(plain.body.length)
  if (!plain.body.endsWith('</g>')) throw new Error('The mascot is no longer drawn as one body group: see kumiWhole in video/build.mjs')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${plain.viewBox}">${plain.body.slice(0, -4)}${robot}</g></svg>`
}

const svg = ({ viewBox, body }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`
const dataUri = (svgText) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
const font = (pkg, file) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64')}`

/** What the page needs, as data for film.js. */
function assets() {
  const bots = {}
  for (const bot of CREW) {
    bots[bot.id] = {
      name: bot.name,
      emoji: bot.emoji,
      full: bot.id === 'kumi' ? kumiWhole() : svg(drawMascot(bot.look, bot.emoji, { id: ID })),
      head: svg(drawMascot(bot.look, bot.emoji, { id: ID, crop: 'head' })),
      sign: signColors(bot.look),
    }
  }

  // Every superpower that ships with the app, by name as the app lists them. Each icon is its own
  // picture, so the ids inside one cannot clash with another's.
  const dir = path.join(root, 'apps/server/superpowers')
  const powers = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'superpower.json')))
    .map((entry) => {
      const { name } = JSON.parse(fs.readFileSync(path.join(dir, entry.name, 'superpower.json'), 'utf8'))
      const icon = path.join(dir, entry.name, 'icon.svg')
      return { id: entry.name, name, icon: fs.existsSync(icon) ? dataUri(fs.readFileSync(icon, 'utf8')) : null }
    })
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

  const marks = {
    claude: markOf({ id: 'claude-code', detail: '' }),
    chatgpt: markOf({ id: 'codex', detail: '' }),
    grok: markOf({ id: 'grok', detail: '' }),
    local: markOf({ id: 'local', detail: 'Ollama' }),
  }

  // The light pictures: the film is in the website's light colours.
  const shot = (name) => {
    const file = path.join(site, 'src/assets/screenshots', `${name}-light.png`)
    if (!fs.existsSync(file)) throw new Error(`The film needs ${path.relative(root, file)}: take it with npm run screenshots -w @openkumi/marketing`)
    return pathToFileURL(file).href
  }

  return { bots, powers, marks, shots: { conversation: shot('conversation'), browser: shot('browser') } }
}

/**
 * Writes the page into `dir` and gives its path. The screenshots stay where they are and are
 * linked by file URL, so the page is opened from the disk rather than served.
 */
export function build(dir) {
  // `<` is escaped so nothing in the data can end the script it is in.
  const data = JSON.stringify(assets()).replace(/</g, '\\u003c')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OpenKumi film</title>
<style>
@font-face { font-family: Display; src: url(${font('bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2')}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: Text; src: url(${font('inter', 'inter-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
${fs.readFileSync(path.join(here, 'film.css'), 'utf8')}
</style>
</head>
<body>
<div id="stage"></div>
<script>window.FILM_ASSETS = ${data}</script>
<script>
${fs.readFileSync(path.join(here, 'film.js'), 'utf8')}
</script>
</body>
</html>
`
  const file = path.join(dir, 'film.html')
  fs.writeFileSync(file, html)
  return file
}
