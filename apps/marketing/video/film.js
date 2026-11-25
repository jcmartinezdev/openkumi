// OpenKumi's short film, as a page that draws any moment of it on request: seek(t) sets every
// style from the time alone, so frames can be drawn in any order, in several tabs at once, and
// come out the same each time. scripts/video.mjs films it; video/build.mjs puts the page together
// and hands this file its pictures as window.FILM_ASSETS. Open the built page with #play at the
// end of its address to watch it run, or #t=12.5 to stop at a moment.
;(() => {
  'use strict'
  const A = window.FILM_ASSETS

  // ---------------------------------------------------------------------------------------------
  // Where the camera looks in each screenshot, as [left, top, width, height] fractions of the
  // picture. The screenshots are retaken when the app changes (scripts/screenshots.mjs); when
  // something moves in them, move its box here. The camera fits a box into the space under the
  // words, keeps the view inside the window, and never enlarges the picture past its own pixels,
  // so a small box shows more around it rather than going soft.
  const CAMERA = {
    conversation: {
      whole: [0, 0, 1, 1],
      // The sidebar: each bot, and the subagents of the open one under it.
      bots: [0, 0.145, 0.36, 0.34],
      // The three "Start subagent" lines and the subagents' cards.
      subagents: [0.33, 0.175, 0.53, 0.39],
      // The table the answer was put together in, and the pick under it.
      answer: [0.33, 0.54, 0.53, 0.3],
    },
    browser: {
      whole: [0, 0, 1, 1],
      // The pages it opened, and its live view floating over the chat at the bottom right.
      live: [0.33, 0.5, 0.66, 0.41],
    },
  }

  // When each scene is on screen, in seconds. Neighbours overlap a little, so one leaves as the
  // next arrives. The times inside a scene count from its start.
  const SCENES = {
    intro: [0, 9], // Kumi drops in, then the crew joins it
    app: [8.6, 21.4], // the app: one conversation per bot, subagents, then the bot's browser
    call: [21, 26.8],
    automations: [26.4, 32.2],
    superpowers: [31.8, 37.4],
    together: [37, 43.4],
    everywhere: [43, 47.6],
    plans: [47.2, 51.6],
    end: [51.2, 55.5],
  }
  const LENGTH = 55.5
  const FPS = 30
  /** The frame the poster is taken from: the crew in line under the title. */
  const POSTER = 7.4

  // ---------------------------------------------------------------------------------------------
  // Time.
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
  const lerp = (a, b, k) => a + (b - a) * k
  /** 0 before `a`, 1 after `b`, and straight between. */
  const ramp = (t, a, b) => (b > a ? clamp((t - a) / (b - a)) : t >= b ? 1 : 0)
  const E = {
    outCubic: (k) => 1 - (1 - k) ** 3,
    inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
    inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
    outBack: (k) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2,
  }
  /** Eased progress from `a` to `b`. */
  const tw = (t, a, b, ease = E.outCubic) => ease(ramp(t, a, b))
  /** How far something has left, gently, starting at `a`. */
  const gone = (t, a, d = 0.45) => tw(t, a, a + d, E.inOutSine)
  /** A jelly's wobble after a bump at time 0: starts at 1, swings and settles. */
  const wobble = (t, freq = 2.4, decay = 4.5) => (t < 0 ? 0 : Math.exp(-decay * t) * Math.cos(2 * Math.PI * freq * t))
  /** Smooth wandering between -1 and 1, different for each seed. */
  const drift = (t, seed) => (Math.sin(t * 9.1 + seed * 1.3) * 0.5 + Math.sin(t * 13.7 + seed * 2.9) * 0.3 + Math.sin(t * 5.3 + seed * 0.7) * 0.2)

  // ---------------------------------------------------------------------------------------------
  // Drawing.
  const stage = document.getElementById('stage')
  let uid = 0
  function el(parent, tag, cls, html) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (html != null) node.innerHTML = html
    if (parent) parent.appendChild(node)
    return node
  }
  function place(node, left, top, width, height) {
    Object.assign(node.style, { left: `${left}px`, top: `${top}px` })
    if (width != null) node.style.width = `${width}px`
    if (height != null) node.style.height = `${height}px`
  }
  /** Sets how see-through a thing is and where it is, off its own place. */
  function set(node, opacity, x = 0, y = 0, scale = 1) {
    node.style.opacity = opacity.toFixed(4)
    node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(4)})`
  }
  const fresh = (svg) => svg.replaceAll('__ID__', `g${uid++}`)

  /** A bot's whole mascot, with its body, eyes and shadow to move. */
  function mascot(parent, id) {
    const node = el(parent, 'div', 'mascot', fresh(A.bots[id].full))
    const svg = node.firstElementChild
    return { node, body: svg.querySelector('.m-body'), eyes: svg.querySelector('.m-eyes'), shadow: svg.querySelector(':scope > ellipse') }
  }
  /**
   * Poses a mascot at time `t`: lifted off the ground (in the drawing's units), squashed or
   * stretched, breathing and now and then blinking. `phase` keeps mascots side by side out of step.
   */
  function pose(m, t, { lift = 0, sx = 1, sy = 1, phase = 0, shadow = 1 } = {}) {
    const breath = Math.sin(((t + phase) * 2 * Math.PI) / 3.4) * 0.016
    m.body.style.transform = `translate(0px, ${(-lift).toFixed(2)}px) scale(${(sx * (1 + breath)).toFixed(4)}, ${(sy * (1 - breath)).toFixed(4)})`
    const period = 4.3
    const p = (((t + phase * 1.37) % period) + period) % period
    const blink = p > period - 0.22 ? Math.sin(((period - p) / 0.22) * Math.PI) : 0
    m.eyes.style.transform = `scaleY(${(1 - 0.88 * blink).toFixed(3)})`
    if (m.shadow) {
      m.shadow.style.opacity = (clamp(shadow) * 0.16).toFixed(3)
      m.shadow.style.transform = `scale(${(0.45 + 0.55 * clamp(shadow)).toFixed(3)})`
    }
  }
  /** A bot's head holding its sign under its chin, as the app shows bots in lists (A.headSign is the app's HEAD_SIGN). */
  function head(id, size, sign = true) {
    const b = A.bots[id]
    const g = A.headSign
    const s = (n) => `${(n * size).toFixed(1)}px`
    const paw = `width:${s(g.paw)};height:${s(g.paw)};background:${b.sign.paw};border-color:${b.sign.pawEdge}`
    const card = sign
      ? `<span class="head-sign" style="width:${s(g.width)};height:${s(g.height)};left:${s((1 - g.width) / 2)};bottom:${s(g.bottom)};border-radius:${s(g.radius)};font-size:${s(g.emoji)};transform:rotate(${g.angle}deg);background:${b.sign.card}">` +
        `<i style="${paw};left:${s(-g.paw / 2)}"></i><i style="${paw};right:${s(-g.paw / 2)}"></i>${b.emoji}</span>`
      : ''
    const lift = sign ? `;transform:translateY(${s(-g.lift)})` : ''
    return `<span class="head" style="width:${size}px;height:${size}px${lift}">${fresh(b.head)}${card}</span>`
  }
  /** A name tag centred on `cx`. */
  function tag(parent, text, cx, top) {
    const box = el(parent, 'div')
    place(box, cx - 200, top, 400)
    Object.assign(box.style, { display: 'flex', justifyContent: 'center' })
    return el(box, 'div', 'tag', text)
  }
  /**
   * Words at the top of a scene: the title rises in word by word, the line under it follows,
   * and both leave together at `until`.
   */
  function caption(parent, title, sub, { top = 110, big = false } = {}) {
    const box = el(parent, 'div', `caption${big ? ' big' : ''}`)
    box.style.top = `${top}px`
    const h = el(box, 'h2')
    const words = title.split(' ').map((word, i) => {
      if (i) h.append(' ')
      return el(h, 'span', 'w', word)
    })
    const p = sub ? el(box, 'p') : null
    const line = p ? el(p, 'span', null, sub) : null
    return (t, from, until) => {
      box.style.display = t < from || t > until ? 'none' : ''
      words.forEach((w, i) => {
        const k = tw(t, from + i * 0.06, from + i * 0.06 + 0.75)
        set(w, k, 0, 34 * (1 - k))
      })
      if (line) {
        const k = tw(t, from + 0.35, from + 1.05)
        set(line, k, 0, 18 * (1 - k))
      }
      const out = gone(t, until - 0.45)
      set(box, 1 - out, 0, -20 * out)
    }
  }

  const ICON = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path class="hand-h" d="M12 12V8"/><path class="hand-m" d="M12 12V5.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    hangUp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.6 13.4c5.4-4.6 13.4-4.6 18.8 0 .6.5.7 1.4.2 2l-1.4 1.7c-.4.5-1.1.6-1.7.4l-2.7-1.1c-.5-.2-.8-.7-.8-1.2v-1.6c-2-.6-4-.6-6 0v1.6c0 .5-.3 1-.8 1.2l-2.7 1.1c-.6.2-1.3.1-1.7-.4l-1.4-1.7c-.5-.6-.4-1.5.2-2z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="5" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 7.2v1.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.2M12 11.5v5.3"/></svg>',
  }

  // ---------------------------------------------------------------------------------------------
  // The scenes. Each builds its pictures once and gives back a function that poses them at a time
  // counted from the scene's start.
  const scenes = []
  function scene(name, make) {
    const [start, end] = SCENES[name]
    const root = el(stage, 'section', `scene scene-${name}`)
    scenes.push({ start, end, root, pose: make(root, end - start) })
  }

  // The soft light behind everything, drifting slowly.
  const skyGlow = el(stage, 'div', 'glow sky')
  const orangeGlow = el(stage, 'div', 'glow orange')
  function light(t) {
    set(skyGlow, 1, 1420 + 160 * Math.sin(t * 0.12), 250 + 110 * Math.cos(t * 0.1))
    set(orangeGlow, 1, 380 + 150 * Math.cos(t * 0.11), 860 + 90 * Math.sin(t * 0.14))
  }

  // 1–2. Kumi drops in and says who it is; then the crew pops up beside it.
  scene('intro', (root, len) => {
    const order = ['kumi', 'researcher', 'inbox', 'chef', 'travel', 'money', 'coach', 'ideas']
    const ratio = 200 / 224 // a whole mascot's width to its height
    const SLOT = 212
    const ROW = 505
    const SMALL = 230
    const cx = (i) => 960 + (i - (order.length - 1) / 2) * SLOT
    const BIG = { h: 460, top: 175 }
    BIG.left = 960 - (BIG.h * ratio) / 2

    const kumi = mascot(root, 'kumi')
    place(kumi.node, BIG.left, BIG.top, BIG.h * ratio, BIG.h)
    const crew = order.slice(1).map((id, i) => {
      const m = mascot(root, id)
      place(m.node, cx(i + 1) - (SMALL * ratio) / 2, ROW, SMALL * ratio, SMALL)
      return m
    })
    const tags = order.map((id, i) => tag(root, A.bots[id].name, cx(i), ROW + SMALL + 16))
    const meet = caption(root, 'Meet Kumi.', 'Your first bot, and your main assistant.', { top: 672, big: true })
    const title = caption(root, 'Your own crew of AI bots.', 'Each has its own memory, files and browser.', { top: 285 })
    const HIGH = 420

    return (t) => {
      meet(t, 1.05, 3.95)
      title(t, 4.95, len - 0.15)

      // Kumi falls, stretching a little, and lands with a squish...
      let lift = 0
      let sx = 1
      let sy = 1
      if (t < 0.85) {
        const k = ramp(t, 0.2, 0.85)
        lift = HIGH * (1 - k * k)
        sy = 1 + 0.1 * k
        sx = 1 - 0.06 * k
      } else {
        const w = wobble(t - 0.85, 2.2, 4.2)
        sy = 1 - 0.2 * w
        sx = 1 + 0.15 * w
      }
      // ...then hops over to the start of the line.
      const m = tw(t, 3.85, 4.85, E.inOutCubic)
      lift += Math.sin(Math.PI * m) * 60
      const landed = wobble(t - 4.85, 2.6, 5)
      sy *= 1 - 0.12 * landed
      sx *= 1 + 0.09 * landed
      const out = gone(t, len - 0.95)
      set(kumi.node, 1 - out, lerp(0, cx(0) - (SMALL * ratio) / 2 - BIG.left, m), lerp(0, ROW - BIG.top, m) + 50 * out, lerp(1, SMALL / BIG.h, m))
      pose(kumi, t, { lift, sx, sy, shadow: 1 - lift / HIGH })

      crew.forEach((c, i) => {
        const at = 4.5 + i * 0.1
        const k = ramp(t, at, at + 0.55)
        const s = k <= 0 ? 0 : E.outBack(k)
        const w = wobble(t - at - 0.55, 2.6, 5)
        const leave = gone(t, len - 0.95 + (i + 1) * 0.04)
        set(c.node, k > 0 ? 1 - leave : 0, 0, 50 * leave)
        pose(c, t, { sx: s * (1 + 0.07 * w), sy: s * (1 - 0.09 * w), phase: i * 0.9 + 0.5, shadow: s })
      })
      tags.forEach((n, i) => {
        const at = (i ? 4.5 + (i - 1) * 0.1 : 4.45) + 0.3
        const k = tw(t, at, at + 0.5)
        const leave = gone(t, len - 0.95 + i * 0.04)
        set(n, k * (1 - leave), 0, 14 * (1 - k) + 50 * leave)
      })
    }
  })

  // 3–4. The app: one conversation per bot, a big job split into subagents, then a bot browsing.
  scene('app', (root, len) => {
    const WORLD = { w: 1600, h: 1000 } // the window's size before the camera
    const REGION = { x: 80, y: 236, w: 1760, h: 810 } // where the camera's view goes, under the words
    const MAX_ZOOM = 2880 / WORLD.w // the screenshots are 2880 pixels across
    // What the camera sees fades out under the words, so a screenshot zoomed past them never shows through.
    const lens = el(root, 'div', 'lens')
    const view = el(lens, 'div', 'window')
    el(view, 'img').src = A.shots.conversation
    const browser = el(view, 'img')
    browser.src = A.shots.browser
    const one = caption(root, 'One conversation per bot.', 'A bot is someone you talk to, not a list of chats.', { top: 62 })
    const split = caption(root, 'Big jobs split into subagents.', 'They work side by side, and what they find comes back to the bot.', { top: 62 })
    const browse = caption(root, 'A browser of its own that stays signed in.', 'Watch it browse, or take control and hand it back.', { top: 62 })

    const C = CAMERA.conversation
    const B = CAMERA.browser
    // [time, box]: the camera holds on a box until the next time, then moves to the next box.
    // Two at the same time cut from one to the other, while the window is out of sight.
    const SWAP = 7.95
    const path = [
      [0, C.whole],
      [1.4, C.whole],
      [3.0, C.bots],
      [3.7, C.bots],
      [4.9, C.subagents],
      [5.9, C.subagents],
      [7.0, C.answer],
      [SWAP, C.answer],
      [SWAP, B.whole],
      [9.0, B.whole],
      [10.4, B.live],
    ]
    function aim([x, y, w, h]) {
      const s = Math.min(REGION.w / (w * WORLD.w), REGION.h / (h * WORLD.h), MAX_ZOOM)
      const hw = REGION.w / (s * WORLD.w) / 2
      const hh = REGION.h / (s * WORLD.h) / 2
      return { s, cx: hw >= 0.5 ? 0.5 : clamp(x + w / 2, hw, 1 - hw), cy: hh >= 0.5 ? 0.5 : clamp(y + h / 2, hh, 1 - hh) }
    }
    function camera(t) {
      let i = 0
      while (i < path.length - 1 && t >= path[i + 1][0]) i++
      const a = aim(path[i][1])
      if (i === path.length - 1) return a
      const b = aim(path[i + 1][1])
      const k = tw(t, path[i][0], path[i + 1][0], E.inOutCubic)
      return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), s: a.s * (b.s / a.s) ** k }
    }

    return (t) => {
      one(t, 0.6, 3.55)
      split(t, 3.65, SWAP - 0.1)
      browse(t, SWAP + 0.1, len)
      const { cx, cy, s } = camera(t)
      const enter = tw(t, 0.25, 1.15)
      const out = gone(t, len - 0.55, 0.5)
      // From one screenshot to the other: the window dips out and comes back showing the other bot.
      const dip = t < SWAP ? 1 - gone(t, SWAP - 0.4, 0.4) : tw(t, SWAP, SWAP + 0.55)
      const x = REGION.x + REGION.w / 2 - cx * WORLD.w * s
      const y = REGION.y + REGION.h / 2 - cy * WORLD.h * s + 90 * (1 - enter) + 30 * out + 40 * (1 - dip)
      set(view, enter * dip * (1 - out), x, y, s)
      set(browser, t >= SWAP ? 1 : 0)
      // Higher while the whole window shows, so its top is never cut; down to the words once zoomed in.
      const k = clamp((s - 0.86) / 0.35)
      const mask = `linear-gradient(to bottom, transparent ${lerp(140, 226, k).toFixed(1)}px, #000 ${lerp(180, 272, k).toFixed(1)}px)`
      lens.style.webkitMaskImage = mask
      lens.style.maskImage = mask
    }
  })

  // 5. A call.
  scene('call', (root, len) => {
    const words = caption(root, 'Call your bot. It talks back.', 'Talk, and it answers at once. Interrupt it whenever you like.', { top: 110 })
    const panel = el(root, 'div', 'call')
    const left = el(panel, 'div', 'call-left')
    const kumi = mascot(left, 'kumi')
    const right = el(panel, 'div', 'call-right')
    el(right, 'div', 'call-name', 'Kumi')
    const clock = el(el(right, 'div', 'call-status', '<i></i>'), 'span')
    const row = el(right, 'div', 'bars')
    const bars = Array.from({ length: 30 }, () => el(row, 'i'))
    const lines = [
      { who: 'You', cls: 'you', text: 'Is there a train to Porto on Friday?', from: 1.45, to: 2.85 },
      { who: 'Kumi', cls: 'bot', text: 'I’ve asked Travel. I’ll read you the times.', from: 3.2, to: 4.85 },
    ].map((line) => {
      const box = el(right, 'div', `said ${line.cls}`)
      el(box, 'b', null, line.who)
      const text = el(box, 'div')
      const spans = line.text.split(' ').map((w, i) => {
        if (i) text.append(' ')
        return el(text, 'span', null, w)
      })
      return { ...line, box, spans }
    })
    el(right, 'div', 'call-buttons', `<span>${ICON.mic}</span><span class="end">${ICON.hangUp}</span>`)
    /** How loud each side is: rises as it starts talking and falls as it stops. */
    const voice = (t, from, to) => tw(t, from - 0.1, from + 0.15) * (1 - tw(t, to, to + 0.3))

    return (t) => {
      words(t, 0.45, len)
      const enter = tw(t, 0.45, 1.2)
      const out = gone(t, len - 0.5, 0.5)
      set(panel, enter * (1 - out), 0, 60 * (1 - enter) + 30 * out, 0.97 + 0.03 * enter)
      const seconds = 12 + Math.floor(Math.max(0, t - 0.4))
      clock.textContent = `On a call · 0:${String(seconds).padStart(2, '0')}`

      const you = voice(t, lines[0].from, lines[0].to)
      const bot = voice(t, lines[1].from, lines[1].to)
      const loud = Math.max(you, bot)
      const colour = bot > you ? '#2f9cf4' : you > 0.02 ? '#f07a2c' : '#d6d1c5'
      bars.forEach((b, i) => {
        const bell = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / bars.length)
        const h = 14 + 104 * loud * bell * (0.4 + 0.6 * Math.abs(drift(t, i)))
        b.style.height = `${h.toFixed(1)}px`
        b.style.background = colour
      })
      // Kumi bobs along with its own voice.
      pose(kumi, t, { lift: bot * 5 * (0.5 + 0.5 * Math.sin(t * 13)), sy: 1 - bot * 0.015 * (1 + Math.sin(t * 13)), phase: 1.2 })
      for (const line of lines) {
        line.spans.forEach((s, i) => {
          const at = line.from + ((line.to - line.from) * i) / line.spans.length
          set(s, tw(t, at, at + 0.2), 0, 0)
        })
        set(line.box.firstChild, tw(t, line.from - 0.15, line.from + 0.15))
      }
    }
  })

  // 6. Automations: three ways a bot starts on its own.
  scene('automations', (root, len) => {
    const words = caption(root, 'Works while you’re away.', 'It tells you in its conversation what came of it.', { top: 140 })
    const linear = A.powers.find((p) => p.id === 'linear')
    const cards = [
      {
        chip: 'sky', icon: ICON.clock, kind: 'At set times', big: 'Every weekday at 7:30', bot: 'inbox', job: 'Morning briefing', fire: 1.7,
        visual: `<div class="days">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => `<span class="${i < 5 ? 'on' : ''}">${d}</span>`).join('')}</div>`,
      },
      {
        chip: 'orange', icon: ICON.eye, kind: 'When a page changes', big: 'A fare to Lisbon drops', bot: 'travel', job: 'Watch the fare', fire: 2.5,
        visual: '<div class="fare"><span>Berlin → Lisbon, 27 Mar</span><span class="price"><span class="old">€189</span><span class="new">€149</span></span></div>',
      },
      {
        chip: 'green', icon: ICON.bolt, kind: 'When an app calls', big: 'A new issue in Linear', bot: 'kumi', job: 'Sort new issues', fire: 3.3,
        visual: `<div class="hook">${linear?.icon ? `<img src="${linear.icon}" alt="">` : ''}<span class="line"><i class="dot"></i></span>${head('kumi', 58)}</div>`,
      },
    ].map((c, i) => {
      const card = el(root, 'div', 'auto')
      place(card, 150 + i * 550, 420)
      const ring = el(card, 'div', 'ring')
      el(card, 'div', 'auto-kind', `<span class="chip ${c.chip}">${c.icon}</span><span>${c.kind}</span>`)
      el(card, 'div', 'auto-big', c.big)
      el(card, 'div', 'auto-visual', c.visual)
      const foot = el(card, 'div', 'auto-foot', `${head(c.bot, 46)}<span><b>${A.bots[c.bot].name}</b>${c.job}</span>`)
      const state = el(foot, 'div', 'state')
      const idle = el(state, 'span', 'idle', '<i></i>On')
      const run = el(state, 'span', 'run', '<i></i>Running')
      const done = el(state, 'span', 'done', `${ICON.check}Told you`)
      return { ...c, card, ring, idle, run, done, hand: card.querySelector('.hand-m'), hour: card.querySelector('.hand-h'), old: card.querySelector('.old'), fresh: card.querySelector('.new'), dot: card.querySelector('.dot') }
    })

    return (t) => {
      words(t, 0.45, len)
      cards.forEach((c, i) => {
        const enter = tw(t, 0.5 + i * 0.15, 1.25 + i * 0.15)
        const out = gone(t, len - 0.6 + i * 0.05, 0.45)
        set(c.card, enter * (1 - out), 0, 60 * (1 - enter) + 30 * out)
        const running = tw(t, c.fire, c.fire + 0.25)
        const finished = tw(t, c.fire + 1.0, c.fire + 1.25)
        set(c.idle, 1 - running)
        set(c.run, running * (1 - finished))
        set(c.done, finished, 0, 0, 0.9 + 0.1 * finished)
        c.run.querySelector('i').style.opacity = (0.55 + 0.45 * Math.cos((t - c.fire) * 7)).toFixed(3)
        set(c.ring, running * (1 - tw(t, c.fire + 1.1, c.fire + 1.8)))
        if (c.hand) {
          // The clock comes round to half past seven as the morning briefing starts.
          const k = tw(t, 0.4, c.fire, E.inOutCubic)
          c.hand.setAttribute('transform', `rotate(${lerp(-240, 180, k)} 12 12)`)
          c.hour.setAttribute('transform', `rotate(${lerp(170, 225, k)} 12 12)`)
        }
        if (c.old) {
          const k = tw(t, c.fire - 0.1, c.fire + 0.35)
          set(c.old, 1 - k, 0, -22 * k)
          set(c.fresh, k, 0, 22 * (1 - k))
        }
        if (c.dot) {
          const k = tw(t, c.fire - 0.5, c.fire, E.inOutSine)
          c.dot.style.left = `${(k * 100).toFixed(2)}%`
          c.dot.style.opacity = (tw(t, c.fire - 0.6, c.fire - 0.45) * (1 - tw(t, c.fire, c.fire + 0.2))).toFixed(3)
        }
      })
    }
  })

  // 7. Superpowers: every one there is, and three switched on for one bot.
  scene('superpowers', (root, len) => {
    const words = caption(root, 'Superpowers, switched on by you.', 'One bot at a time. A bot cannot give itself more.', { top: 110 })
    const chosen = ['weather', 'exchange-rates', 'holidays']
    const bot = el(root, 'div', 'bot-card')
    const researcher = mascot(bot, 'researcher')
    el(bot, 'div', 'tag', 'Researcher')
    const list = el(bot, 'div', 'toggles')
    const toggles = chosen.map((id) => {
      const power = A.powers.find((p) => p.id === id)
      const row = el(list, 'div', 'toggle', `${power?.icon ? `<img src="${power.icon}" alt="">` : ''}<span>${power?.name ?? id}</span>`)
      const track = el(row, 'span', 'switch')
      return { track, knob: el(track, 'i') }
    })
    const grid = el(root, 'div', 'grid')
    const COLS = 8
    const STEP = 126
    const tiles = A.powers.map((power, i) => {
      const tile = el(grid, 'div', 'power', power.icon ? `<img src="${power.icon}" alt="">` : '')
      const col = i % COLS
      const row = Math.floor(i / COLS)
      place(tile, col * STEP, row * STEP)
      const pick = chosen.indexOf(power.id)
      const ring = pick >= 0 ? el(tile, 'div', 'on') : null
      const tick = pick >= 0 ? el(tile, 'div', 'tick', ICON.check) : null
      return { tile, at: 0.5 + (col + row) * 0.05, pick, ring, tick }
    })
    const switchAt = (k) => 2.3 + k * 0.45

    return (t) => {
      words(t, 0.45, len)
      const out = gone(t, len - 0.55, 0.5)
      const dim = tw(t, 2.0, 2.6)
      for (const p of tiles) {
        const k = ramp(t, p.at, p.at + 0.5)
        const on = p.pick >= 0 ? tw(t, switchAt(p.pick), switchAt(p.pick) + 0.35) : 0
        const pop = k <= 0 ? 0.6 : 0.6 + 0.4 * E.outBack(k)
        set(p.tile, clamp(k * 2) * (1 - out) * (p.pick >= 0 ? 1 : 1 - 0.62 * dim), 0, 20 * out, pop * (1 + 0.06 * on))
        if (p.ring) {
          set(p.ring, on)
          set(p.tick, on, 0, 0, 0.5 + 0.5 * E.outBack(clamp(on)))
        }
      }
      const enter = tw(t, 0.9, 1.6)
      set(bot, enter * (1 - out), 0, 50 * (1 - enter) + 30 * out)
      pose(researcher, t, { phase: 2.1 })
      toggles.forEach((s, k) => {
        const on = tw(t, switchAt(k), switchAt(k) + 0.35, E.inOutCubic)
        s.knob.style.transform = `translateX(${(24 * on).toFixed(2)}px)`
        s.track.style.background = on > 0 ? `color-mix(in srgb, #22a55b ${(on * 100).toFixed(1)}%, #d6d1c5)` : '#d6d1c5'
      })
    }
  })

  // 8. Bots working together: one passes a job to another and gets the answer back.
  scene('together', (root, len) => {
    const words = caption(root, 'Bots pass work to each other.', 'You read every message, in both conversations.', { top: 110 })
    const LEFT = 190
    const RIGHT = 1040
    const TOP = 350
    const card = (x, id) => {
      const box = el(root, 'div', 'convo')
      place(box, x, TOP)
      el(box, 'div', 'convo-head', `${head(id, 52)}<span>${A.bots[id].name}</span>`)
      return { box, body: el(box, 'div', 'convo-body') }
    }
    // A message between bots, labelled as the app labels it (the together and browser screenshots).
    const note = (parent, top, cls, label, aside, text) => {
      const n = el(parent, 'div', `note ${cls}`, `<div class="note-label">${ICON.branch}<b>${label}</b>${aside ? `<span>${aside}</span>` : ''}</div>${text}`)
      n.style.top = `${top}px`
      return n
    }
    // The exchange the app's screenshots show, made shorter.
    const ask = 'Find two hotels in Lisbon for 27–29 March, under €160 a night.'
    const answer = 'Hotel Bairro Alto at €148 a night, or Memmo Príncipe Real at €156.'
    const kumi = card(LEFT, 'kumi')
    const travel = card(RIGHT, 'travel')
    const q = el(kumi.body, 'div', 'ask', 'Can you ask Travel to find a hotel in Lisbon?')
    q.style.top = '0px'
    const sent = note(kumi.body, 92, 'out', 'To Travel', 'asked for a reply', ask)
    const back = note(kumi.body, 252, 'in', 'From Travel', '', answer)
    const got = note(travel.body, 0, 'in', 'From Kumi', 'asks for a reply', ask)
    const working = el(travel.body, 'div', 'working', `${head('travel', 36, false)}<span>Working</span><i></i><i></i><i></i>`)
    working.style.top = '178px'
    const dots = [...working.querySelectorAll('i')]
    const reply = note(travel.body, 160, 'out', 'To Kumi', '', answer)
    const told = el(travel.body, 'div', 'reply', 'I sent Kumi two hotels by the river.')
    told.style.top = '318px'
    const summed = el(kumi.body, 'div', 'reply', 'Travel found two. Shall I ask it to book the first?')
    summed.style.top = '408px'
    const flyer = el(root, 'div', 'flyer', ICON.note)
    // Where the message leaves from and arrives, on the stage.
    const goes = { from: [LEFT + 640, TOP + 112 + 92 + 63], to: [RIGHT + 50, TOP + 112 + 63] }
    const comes = { from: [RIGHT + 50, TOP + 112 + 160 + 63], to: [LEFT + 640, TOP + 112 + 252 + 63] }
    const T = { sent: 0.9, flown: 2.0, working: 2.15, reply: 3.0, back: 4.1 }
    const fly = (t, a, b, route) => {
      const k = tw(t, a, b, E.inOutCubic)
      const [x0, y0] = route.from
      const [x1, y1] = route.to
      const lift = Math.sin(Math.PI * k) * 120
      const visible = tw(t, a - 0.1, a + 0.1) * (1 - tw(t, b - 0.1, b + 0.05))
      return { k, x: lerp(x0, x1, k), y: lerp(y0, y1, k) - lift, visible }
    }
    const rise = (node, t, at) => {
      const k = tw(t, at, at + 0.5)
      set(node, k, 0, 24 * (1 - k))
    }

    return (t) => {
      words(t, 0.45, len)
      const out = gone(t, len - 0.55, 0.5)
      ;[kumi, travel].forEach((c, i) => {
        const enter = tw(t, 0.45 + i * 0.15, 1.15 + i * 0.15)
        set(c.box, enter * (1 - out), 0, 60 * (1 - enter) + 30 * out)
      })
      rise(sent, t, T.sent)
      rise(got, t, T.flown)
      const busy = tw(t, T.working, T.working + 0.3) * (1 - tw(t, T.reply - 0.2, T.reply))
      set(working, busy)
      dots.forEach((d, i) => (d.style.opacity = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 7 - i * 0.9))).toFixed(3)))
      rise(reply, t, T.reply)
      rise(back, t, T.back + 0.05)
      rise(told, t, T.reply + 0.45)
      rise(summed, t, T.back + 0.6)
      const there = fly(t, T.sent + 0.45, T.flown, goes)
      const home = fly(t, T.reply + 0.35, T.back, comes)
      const f = t < T.reply ? there : home
      set(flyer, f.visible * (1 - out), f.x, f.y, 0.8 + 0.2 * Math.sin(Math.PI * f.k))
    }
  })

  // 9. From anywhere: the Mac, a computer at home, the iPhone.
  scene('everywhere', (root, len) => {
    const words = caption(root, 'Reach your bots from anywhere.', 'Your Mac, a computer at home, your iPhone. Pair them with a one-time code.', { top: 110 })
    const bots = ['kumi', 'researcher', 'inbox', 'chef', 'travel']
    const side = bots.map((id) => `<div class="mini-row">${head(id, 26, false)}<u></u></div>`).join('')
    const chat = '<div class="me"></div><u style="width:88%"></u><u style="width:72%"></u><u style="width:80%"></u><div class="me" style="width:42%"></div><u style="width:65%"></u>'
    const devices = el(root, 'div', 'devices')
    const laptop = el(devices, 'div', 'laptop', `<div class="lid"><div class="screen"><div class="mini-side">${side}</div><div class="mini-chat">${chat}</div></div></div><div class="base"></div>`)
    place(laptop, 210, 530)
    const home = el(devices, 'div', 'home', '<div class="box"><i></i></div>')
    place(home, 740, 470)
    // The crew stands on the computer at home, where they run.
    const standing = ['researcher', 'inbox', 'kumi', 'chef', 'travel'].map((id, i) => {
      const m = mascot(home, id)
      const h = id === 'kumi' ? 124 : 102
      // Its feet are 217/224 of the way down its picture: they rest just behind the box's front edge.
      place(m.node, 220 + (i - 2) * 94 - (h * 200) / 224 / 2, 304 - h * (217 / 224), (h * 200) / 224, h)
      return m
    })
    const phone = el(devices, 'div', 'phone', `<div class="screen"><div class="notch"></div><div class="mini-chat"><div class="who">${head('kumi', 26, false)}Kumi</div>${chat}</div></div>`)
    place(phone, 1360, 430)
    const labels = [
      [450, 'Mac'],
      [960, 'A computer at home'],
      [1470, 'iPhone'],
    ].map(([x, text]) => {
      const n = el(root, 'div', 'device-label', text)
      n.style.left = `${x}px`
      return n
    })
    // Dots running from the computer at home out to the Mac and the phone.
    const svgNs = 'http://www.w3.org/2000/svg'
    const lines = document.createElementNS(svgNs, 'svg')
    lines.setAttribute('class', 'routes')
    lines.setAttribute('viewBox', '0 0 1920 1080')
    root.appendChild(lines)
    const routes = ['M925 628 Q790 450 668 580', 'M995 628 Q1170 420 1350 530'].map((d) => {
      const p = document.createElementNS(svgNs, 'path')
      p.setAttribute('d', d)
      p.setAttribute('fill', 'none')
      p.setAttribute('stroke', '#2f9cf4')
      p.setAttribute('stroke-width', '5')
      p.setAttribute('stroke-linecap', 'round')
      p.setAttribute('stroke-dasharray', '0.1 18')
      lines.appendChild(p)
      return p
    })
    const parts = [laptop, home, phone]

    return (t) => {
      words(t, 0.45, len)
      const out = gone(t, len - 0.55, 0.5)
      parts.forEach((p, i) => {
        const enter = tw(t, 0.5 + i * 0.15, 1.25 + i * 0.15)
        set(p, enter * (1 - out), 0, 70 * (1 - enter) + 30 * out)
        set(labels[i], tw(t, 0.8 + i * 0.15, 1.4 + i * 0.15) * (1 - out))
      })
      standing.forEach((m, i) => {
        const at = 0.95 + Math.abs(i - 2) * 0.1
        const k = ramp(t, at, at + 0.5)
        const s = k <= 0 ? 0 : E.outBack(k)
        pose(m, t, { sx: s, sy: s, shadow: s, phase: i * 0.8 })
      })
      const show = tw(t, 1.6, 2.2) * (1 - out)
      routes.forEach((r) => {
        r.style.opacity = show.toFixed(3)
        r.setAttribute('stroke-dashoffset', (-t * 30).toFixed(2))
      })
    }
  })

  // 10. What the bots run on.
  scene('plans', (root, len) => {
    const words = caption(root, 'Runs on the plan you already have.', null, { top: 232 })
    const plans = [
      { mark: A.marks.claude, name: 'Claude', plan: 'your Claude plan' },
      { mark: A.marks.chatgpt, name: 'ChatGPT', plan: 'your ChatGPT plan' },
      { mark: A.marks.grok, name: 'Grok', plan: 'your Grok plan' },
      { mark: A.marks.local, name: 'Local models', plan: 'free, on your computer' },
    ].map((p, i) => {
      const { d, color, stroke } = p.mark
      const paint = stroke ? `fill="none" stroke="${color ?? 'currentColor'}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"` : `fill="${color ?? 'currentColor'}"`
      const tile = el(root, 'div', 'plan', `<svg viewBox="0 0 24 24"><path d="${d}" ${paint}/></svg><b>${p.name}</b><small>${p.plan}</small>`)
      place(tile, 286 + i * 346, 400)
      return tile
    })
    const pills = el(root, 'div')
    Object.assign(pills.style, { left: '0', right: '0', top: '742px', display: 'flex', justifyContent: 'center', gap: '24px' })
    const no = ['No API key', 'No account'].map((text) => el(pills, 'div', 'pill', `${ICON.check}${text}`))

    return (t) => {
      words(t, 0.45, len)
      const out = gone(t, len - 0.55, 0.5)
      plans.forEach((p, i) => {
        const enter = tw(t, 0.5 + i * 0.13, 1.2 + i * 0.13)
        set(p, enter * (1 - out), 0, 60 * (1 - enter) + 30 * out)
      })
      no.forEach((p, i) => {
        const k = ramp(t, 1.9 + i * 0.25, 2.4 + i * 0.25)
        set(p, clamp(k * 2) * (1 - out), 0, 30 * out, k <= 0 ? 0.8 : 0.8 + 0.2 * E.outBack(k))
      })
    }
  })

  // 11. The end: Kumi, the name and where to find it.
  scene('end', (root) => {
    const kumi = mascot(root, 'kumi')
    const name = el(root, 'div', 'wordmark', 'OpenKumi')
    const line = el(root, 'div', 'end-line', 'Free and open source')
    const row = el(root, 'div')
    Object.assign(row.style, { left: '0', right: '0', top: '806px', display: 'flex', justifyContent: 'center' })
    const url = el(row, 'div', 'url', 'openkumi.ai')
    const HIGH = 300

    return (t) => {
      let lift = 0
      let sx = 1
      let sy = 1
      if (t < 0.8) {
        const k = ramp(t, 0.25, 0.8)
        lift = HIGH * (1 - k * k)
        sy = 1 + 0.08 * k
        sx = 1 - 0.05 * k
      } else {
        const w = wobble(t - 0.8, 2.2, 4.2)
        sy = 1 - 0.18 * w
        sx = 1 + 0.14 * w
      }
      set(kumi.node, t < 0.25 ? 0 : 1)
      pose(kumi, t, { lift, sx, sy, shadow: 1 - lift / HIGH, phase: 0.4 })
      const k = tw(t, 0.9, 1.6)
      set(name, k, 0, 40 * (1 - k))
      const l = tw(t, 1.25, 1.95)
      set(line, l, 0, 24 * (1 - l))
      const u = ramp(t, 1.6, 2.2)
      set(url, clamp(u * 2), 0, 0, u <= 0 ? 0.85 : 0.85 + 0.15 * E.outBack(u))
    }
  })

  // ---------------------------------------------------------------------------------------------
  function seek(t) {
    light(t)
    for (const s of scenes) {
      const on = t >= s.start && t <= s.end
      s.root.style.display = on ? 'block' : 'none'
      if (on) s.pose(t - s.start)
    }
  }

  const ready = (async () => {
    await Promise.all(['700 80px Display', '400 30px Text', '500 30px Text', '600 30px Text', '700 30px Text'].map((f) => document.fonts.load(f)))
    await document.fonts.ready
    await Promise.all(
      [...document.images].map((img) =>
        img.decode().catch(() => {
          throw new Error(`The film could not load ${img.src.slice(0, 120)}`)
        }),
      ),
    )
    seek(0)
  })()

  window.film = { length: LENGTH, fps: FPS, poster: POSTER, scenes: SCENES, seek, ready }

  // In a browser: #play runs it in real time, #t=12.5 stops at a moment.
  const hash = location.hash
  if (hash.startsWith('#t=')) ready.then(() => seek(Number(hash.slice(3)) || 0))
  if (hash === '#play') {
    ready.then(() => {
      const start = performance.now()
      const tick = (now) => {
        seek(((now - start) / 1000) % LENGTH)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }
})()
