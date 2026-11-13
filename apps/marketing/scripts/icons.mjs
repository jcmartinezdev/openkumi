// Draws OpenKumi's icons from its mascot (src/lib/brand.ts): the desktop app's, the phone app's,
// and the website's, with its social card. Chrome draws them, so they look as the mascot does in the app.
//   npm run icons -w @openkumi/marketing
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { kumiSvg } from '../src/lib/brand.ts'

const here = path.resolve(import.meta.dirname, '..')
const apps = path.resolve(here, '..')
const out = (...parts) => path.join(apps, ...parts)

/** The tile behind the mascot: the old icon's near-black, lit from behind the mascot. */
const TILE = 'radial-gradient(circle at 50% 46%, #2c4a6e 0%, #1f2a3a 34%, #17171c 64%), linear-gradient(180deg, #26262c, #111114)'
const mascot = (id, crop = 'full') => kumiSvg(id, crop).replace('<svg ', '<svg width="100%" height="100%" ')

/** A square picture `size` across, drawn from `html` laid out on a 1024 square. */
async function draw(page, file, html, size, { opaque = false } = {}) {
  await page.setContent(`<body style="margin:0;width:1024px;height:1024px;position:relative;overflow:hidden">${html}</body>`)
  let png = await page.screenshot({ omitBackground: !opaque, clip: { x: 0, y: 0, width: 1024, height: 1024 } })
  png = await sharp(png).resize(size, size)[opaque ? 'removeAlpha' : 'ensureAlpha']().png({ compressionLevel: 9 }).toBuffer()
  fs.writeFileSync(file, png)
  console.log(path.relative(apps, file), `${size}×${size}`)
}

/** The mascot standing on a tile with rounded corners, inset as macOS draws app icons. */
const tile = (inset, radius, id) =>
  `<div style="position:absolute;inset:${inset}px;border-radius:${radius}px;background:${TILE};box-shadow:inset 0 0 0 2px rgba(255,255,255,.07);display:grid;place-items:center">` +
  `<div style="width:${(1024 - 2 * inset) * 0.8}px;height:${(1024 - 2 * inset) * 0.9}px;margin-top:${(1024 - 2 * inset) * 0.03}px">${mascot(id)}</div></div>`
/** The mascot on a tile that fills the square, for systems that cut the corners themselves. */
const bleed = (id, scale = 0.72) =>
  `<div style="position:absolute;inset:0;background:${TILE};display:grid;place-items:center"><div style="width:${1024 * scale}px;height:${1024 * scale * 1.12}px;margin-top:${1024 * 0.03}px">${mascot(id)}</div></div>`
/** The mascot alone, `scale` of the square across. */
const alone = (id, scale, style = '') =>
  `<div style="position:absolute;inset:0;display:grid;place-items:center"><div style="width:${1024 * scale}px;height:${1024 * scale * 1.12}px;${style}">${mascot(id)}</div></div>`
/** Its head, on a tile with rounded corners, for the smallest places. */
const head = (id) =>
  `<div style="position:absolute;inset:0;border-radius:230px;background:${TILE};display:grid;place-items:center"><div style="width:860px;height:860px;margin-top:90px">${mascot(id, 'head')}</div></div>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })

// The desktop app (electron-builder makes every platform's icon from this).
await draw(page, out('desktop', 'assets', 'icon.png'), tile(100, 185, 'd'), 1024)

// The phone app. iOS rounds the corners and wants no transparency.
await draw(page, out('mobile', 'assets', 'icon.png'), bleed('m'), 1024, { opaque: true })
await draw(page, out('mobile', 'assets', 'splash-icon.png'), alone('s', 0.62), 1024)
await draw(page, out('mobile', 'assets', 'favicon.png'), head('f'), 48)
await draw(page, out('mobile', 'assets', 'android-icon-foreground.png'), alone('a', 0.5), 512)
await draw(page, out('mobile', 'assets', 'android-icon-background.png'), `<div style="position:absolute;inset:0;background:${TILE}"></div>`, 512, { opaque: true })
await draw(page, out('mobile', 'assets', 'android-icon-monochrome.png'), alone('w', 0.5, 'filter:brightness(0) invert(1)'), 432)

// The website.
const site = path.join(here, 'public')
await draw(page, path.join(site, 'apple-touch-icon.png'), bleed('t'), 180, { opaque: true })
await draw(page, path.join(site, 'favicon.png'), head('p'), 64)
await draw(page, path.join(site, 'icon-512.png'), tile(100, 185, 'i'), 512)
fs.writeFileSync(
  path.join(site, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="t" cx="0.5" cy="0.46" r="0.6"><stop offset="0" stop-color="#2c4a6e"/><stop offset="0.55" stop-color="#1f2a3a"/><stop offset="1" stop-color="#17171c"/></radialGradient></defs>` +
    `<rect width="64" height="64" rx="15" fill="url(#t)"/>${kumiSvg('v', 'head').replace('<svg ', '<svg x="4" y="8" width="56" height="56" ')}</svg>`,
)
console.log('marketing/public/favicon.svg')

// The picture a link to the website shows when shared.
const font = (pkg, file) => `data:font/woff2;base64,${fs.readFileSync(path.resolve(here, '../../node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64')}`
await page.setViewportSize({ width: 1200, height: 630 })
await page.setContent(`<style>
  @font-face { font-family: Display; src: url(${font('bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2')}); font-weight: 200 800; }
  @font-face { font-family: Text; src: url(${font('inter', 'inter-latin-wght-normal.woff2')}); font-weight: 100 900; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; color: #f3f2f6;
    background: radial-gradient(40% 60% at 78% 50%, rgb(90 184 255 / .28), transparent 70%), radial-gradient(35% 50% at 18% 18%, rgb(255 154 87 / .16), transparent 70%), #0f0f12; }
  .words { position: absolute; left: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .name { font: 700 34px/1 Display; letter-spacing: -0.02em; color: #a7a5b0; }
  h1 { margin: 0; font: 700 84px/0.98 Display; letter-spacing: -0.04em; }
  p { margin: 0; font: 400 26px/1.4 Text; color: #a7a5b0; }
  .kumi { position: absolute; right: 70px; top: 75px; width: 430px; height: 482px; }
</style>
<div class="words"><span class="name">OpenKumi</span><h1>Your own crew<br>of AI bots.</h1><p>Open source. Runs on your computer.</p></div>
<div class="kumi">${mascot('og')}</div>`)
await page.evaluate(() => document.fonts.ready)
fs.writeFileSync(path.join(site, 'social-card.png'), await sharp(await page.screenshot()).png({ compressionLevel: 9 }).toBuffer())
console.log('marketing/public/social-card.png 1200×630')

await browser.close()
