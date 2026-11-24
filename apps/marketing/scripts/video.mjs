// Makes the short film on the website (public/film/openkumi.mp4, and poster.jpg to show before it
// plays) from code, so it can be made again whenever the app changes: retake the screenshots
// (npm run screenshots), then run this. The film is a page, video/film.js, that draws any moment of
// itself on request; video/build.mjs puts it together with the mascots, icons and screenshots. Chrome
// draws it frame by frame and ffmpeg turns the frames into a video. It has no sound: the website
// plays it muted, so everything it says is on screen. Besides the MP4 that plays everywhere, it makes
// openkumi.webm in AV1, about half the size for the same picture, for the browsers that play it.
//   npm run video -w @openkumi/marketing                          the film and its poster
//   npm run video -w @openkumi/marketing -- --still 7.4           one moment as a PNG, to look at
//   npm run video -w @openkumi/marketing -- --still 1,7.4,12      several moments
//   npm run video -w @openkumi/marketing -- --from 21 --to 27     only that part, into a file of its own
//   npm run video -w @openkumi/marketing -- --page                the page, to watch in Chrome
//   npm run video -w @openkumi/marketing -- --master film.mkv     also keep the lossless master, to try other encodings on
// Stills, parts and the page go to openkumi-film in the system's temporary folder (or --out).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { build } from '../video/build.mjs'

const here = path.resolve(import.meta.dirname, '..')
const FILM = path.join(here, 'public/film')
/** The most the film may weigh: the website loads it on its front page. */
const MOST = 8 * 1024 * 1024
/** And its poster, which shows before the film loads. */
const POSTER_MOST = 200 * 1024
/** How much ffmpeg may throw away: lower is sharper and heavier. 20 keeps the screenshots' small text readable. */
const CRF = 20
/**
 * The same for AV1, on its own scale: 34 measured as good as the H.264 at 20 (VMAF 96.9 against
 * 97.1, on the part with the screenshots) at a little over half the size.
 */
const AV1_CRF = 34

const { values: opts } = parseArgs({
  options: {
    still: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    page: { type: 'boolean' },
    out: { type: 'string' },
    workers: { type: 'string' },
    master: { type: 'string' },
  },
})
const scratch = path.resolve(opts.out ?? path.join(os.tmpdir(), 'openkumi-film'))
const started = Date.now()
const took = () => `${((Date.now() - started) / 1000).toFixed(0)} s`
const mb = (file) => `${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`

// Only the page: build it where it stays, and say where it is.
if (opts.page) {
  fs.mkdirSync(scratch, { recursive: true })
  console.log(`${pathToFileURL(build(scratch)).href}#play`)
  process.exit(0)
}

const stills = opts.still?.split(',').map(Number)
if (stills?.some((t) => !Number.isFinite(t))) throw new Error(`--still takes seconds, such as 7.4 or 1,7.4,12; not "${opts.still}"`)
const part = opts.from != null || opts.to != null
if (!stills) needFfmpeg()

/** ffmpeg is a program of its own, not a package: say how to get it rather than fail halfway. */
function needFfmpeg() {
  const found = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  const how = 'Install it with `brew install ffmpeg` on a Mac, `sudo apt install ffmpeg` on Debian or Ubuntu, or from https://ffmpeg.org/download.html.'
  if (found.error || found.status) {
    console.error(`Making the film needs ffmpeg, which was not found. ${how}`)
    process.exit(1)
  }
  if (!found.stdout.includes('libx264')) {
    console.error(`The ffmpeg found has no H.264 encoder (libx264), which the film is made with. ${how}`)
    process.exit(1)
  }
  // The website lists the AV1 copy as well, so the whole film is not made without it.
  if (!part && !found.stdout.includes('libsvtav1')) {
    console.error(`The ffmpeg found has no AV1 encoder (libsvtav1), which the website's WebM copy is made with. ${how}`)
    process.exit(1)
  }
}

/** Runs ffmpeg to the end, with its own messages kept quiet unless it fails. */
function ffmpeg(args, input) {
  // SVT-AV1 has a log of its own, which SVT_LOG=1 keeps to errors as well.
  const run = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'], env: { ...process.env, SVT_LOG: '1' } })
  const done = new Promise((resolve, reject) => {
    run.on('error', reject)
    run.on('exit', (code) => (code ? reject(new Error(`ffmpeg stopped with code ${code}: ffmpeg ${args.join(' ')}`)) : resolve()))
  })
  return { stdin: run.stdin, done }
}

/**
 * The film as the website plays it: H.264 in an MP4, in the colours browsers expect of HD video
 * (BT.709, so the background matches the page's), with the index at the front so it starts
 * playing before it has all loaded, and no sound. `rate` makes it a given number of bits a second
 * instead, in two passes, when keeping the quality would make it too heavy.
 */
/** Converted to BT.709 and labelled so, in the frames and in the file, or browsers guess. */
const COLOURS = [
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
]
async function encode(master, file, { rate } = {}) {
  const common = [
    '-i', master,
    ...COLOURS,
    '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-profile:v', 'high',
    // A keyframe every three seconds, so the website's player can jump about the film.
    '-g', '90',
    '-an',
  ]
  if (!rate) return ffmpeg([...common, '-crf', String(CRF), '-movflags', '+faststart', file]).done
  const log = path.join(path.dirname(master), 'pass')
  await ffmpeg([...common, '-b:v', String(rate), '-pass', '1', '-passlogfile', log, '-f', 'mp4', os.devNull]).done
  await ffmpeg([...common, '-b:v', String(rate), '-pass', '2', '-passlogfile', log, '-movflags', '+faststart', file]).done
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-film-'))
let browser
try {
  const page = build(tmp)
  browser = await chromium.launch({ channel: 'chrome' })

  /** A tab with the film open and ready to draw: its fonts loaded and its pictures decoded. */
  async function open() {
    const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    const failed = []
    tab.on('pageerror', (error) => failed.push(error))
    await tab.goto(pathToFileURL(page).href)
    await tab.evaluate(() => window.film.ready)
    if (failed.length) throw failed[0]
    return tab
  }
  /** The frame at `t` seconds, as a PNG. */
  async function frame(tab, t) {
    await tab.evaluate((at) => window.film.seek(at), t)
    return tab.screenshot({ type: 'png' })
  }

  const first = await open()
  const film = await first.evaluate(() => ({ length: window.film.length, fps: window.film.fps, poster: window.film.poster }))

  if (stills) {
    fs.mkdirSync(scratch, { recursive: true })
    for (const t of stills) {
      const file = path.join(scratch, `still-${t.toFixed(2)}.png`)
      fs.writeFileSync(file, await frame(first, t))
      console.log(file)
    }
  } else {
    const from = Math.max(0, Math.round(Number(opts.from ?? 0) * film.fps))
    const to = Math.min(Math.round(film.length * film.fps), Math.round(Number(opts.to ?? film.length) * film.fps))
    if (!(to > from)) throw new Error(`Nothing to film between ${opts.from ?? 0} s and ${opts.to ?? film.length} s: the film is ${film.length} s long`)

    // Frames are drawn in several tabs at once, then handed to ffmpeg in order. They go first into
    // a master copy that loses nothing, in the temporary folder, so the film can be encoded again
    // from it (at a lower rate, if it came out too heavy) without drawing every frame twice.
    const workers = Math.max(1, Number(opts.workers ?? Math.min(6, Math.max(2, Math.floor(os.availableParallelism() / 2)))))
    const tabs = [first, ...(await Promise.all(Array.from({ length: workers - 1 }, open)))]
    const master = path.join(tmp, 'master.mkv')
    const sink = ffmpeg(['-f', 'image2pipe', '-framerate', String(film.fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', master], true)
    const waiting = new Map()
    let next = from
    let written = from
    const write = (png) => new Promise((resolve) => (sink.stdin.write(png) ? resolve() : sink.stdin.once('drain', resolve)))
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    await Promise.all(
      tabs.map(async (tab) => {
        while (next < to) {
          const n = next++
          // A tab that has got far ahead of the frames written waits, so frames do not pile up in memory.
          while (n - written > tabs.length * 4) await sleep(5)
          waiting.set(n, await frame(tab, n / film.fps))
          // Whoever has the next frame in line writes it; the numbers move on before each write, so they go in order.
          while (waiting.has(written)) {
            const png = waiting.get(written)
            waiting.delete(written++)
            await write(png)
          }
          // In a terminal, one line that counts up; elsewhere (a log), a line every ten seconds of film.
          if (process.stdout.isTTY && (n - from) % film.fps === 0) process.stdout.write(`\rDrawing frame ${n - from + 1} of ${to - from} (${took()})   `)
          else if (!process.stdout.isTTY && (n - from) % (film.fps * 10) === 0) console.log(`Drawing frame ${n - from + 1} of ${to - from} (${took()})`)
        }
      }),
    )
    sink.stdin.end()
    await sink.done
    console.log(`${process.stdout.isTTY ? '\r' : ''}Drew ${to - from} frames in ${took()}.                    `)
    if (opts.master) {
      fs.copyFileSync(master, path.resolve(opts.master))
      console.log(`${path.resolve(opts.master)} (the lossless master, ${mb(master)})`)
    }

    if (part) {
      fs.mkdirSync(scratch, { recursive: true })
      const file = path.join(scratch, `part-${(from / film.fps).toFixed(1)}-${(to / film.fps).toFixed(1)}.mp4`)
      await encode(master, file)
      console.log(`${file} (${mb(file)}, ${took()})`)
    } else {
      fs.mkdirSync(FILM, { recursive: true })
      const file = path.join(FILM, 'openkumi.mp4')
      await encode(master, file)
      if (fs.statSync(file).size > MOST) {
        // Too heavy at that quality: make it exactly as heavy as it may be, a little under.
        const rate = Math.floor((MOST * 0.95 * 8) / film.length)
        console.log(`${mb(file)} is over ${MOST / 1024 / 1024} MB, so again at ${(rate / 1e6).toFixed(2)} Mbit/s.`)
        await encode(master, file, { rate })
      }
      console.log(`${path.relative(process.cwd(), file)} (${mb(file)}, ${film.length} s, ${took()})`)

      // The AV1 copy, which the browsers that play it take first.
      const webm = path.join(FILM, 'openkumi.webm')
      await ffmpeg(['-i', master, ...COLOURS, '-c:v', 'libsvtav1', '-preset', '5', '-crf', String(AV1_CRF), '-g', '90', '-an', webm]).done
      console.log(`${path.relative(process.cwd(), webm)} (${mb(webm)}, ${took()})`)

      // The poster: as good a JPEG as fits.
      const png = await frame(first, film.poster)
      const poster = path.join(FILM, 'poster.jpg')
      for (const quality of [86, 82, 78, 74, 70, 65, 60]) {
        const jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer()
        fs.writeFileSync(poster, jpeg)
        if (jpeg.length <= POSTER_MOST) break
      }
      console.log(`${path.relative(process.cwd(), poster)} (${(fs.statSync(poster).size / 1024).toFixed(0)} KB)`)
    }
  }
} finally {
  await browser?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
