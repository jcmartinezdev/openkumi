// A bot's mascot: a jelly creature holding a sign with the bot's emoji, put together from parts.
// The parts are SVG drawn on a 200-unit square, for every app to show its own way (an <svg> on the
// computer, Skia on the phone). The server keeps the same part names, in apps/server/src/look.ts.
import type { BodyColor, ClothesColor, Creature, Extra, Hat, Look } from '@openbot/shared'

/** The colours a body can be, as they are named in bot.md and shown in the app. */
export const BODY_COLORS: Record<BodyColor, { name: string; hex: string }> = {
  berry: { name: 'Berry', hex: '#ff7eb6' },
  coral: { name: 'Coral', hex: '#ff7a7a' },
  tangerine: { name: 'Tangerine', hex: '#ffa552' },
  lemon: { name: 'Lemon', hex: '#ffd65c' },
  lime: { name: 'Lime', hex: '#9be15d' },
  mint: { name: 'Mint', hex: '#4fd6ad' },
  sky: { name: 'Sky', hex: '#5ab8ff' },
  periwinkle: { name: 'Periwinkle', hex: '#8c9bff' },
  grape: { name: 'Grape', hex: '#b48cff' },
  cocoa: { name: 'Cocoa', hex: '#b88a6a' },
  slate: { name: 'Slate', hex: '#7a8499' },
  cloud: { name: 'Cloud', hex: '#e9e6f2' },
}
/** The colours of what it wears: its hat, bow tie or scarf, and the tips of a bug's antennae. */
export const CLOTHES_COLORS: Record<ClothesColor, { name: string; hex: string }> = {
  navy: { name: 'Navy', hex: '#2f4a8a' },
  red: { name: 'Red', hex: '#e5484d' },
  orange: { name: 'Orange', hex: '#ff8a3d' },
  yellow: { name: 'Yellow', hex: '#ffc53d' },
  forest: { name: 'Forest', hex: '#2f9e6e' },
  teal: { name: 'Teal', hex: '#14a3b8' },
  purple: { name: 'Purple', hex: '#7c5cff' },
  pink: { name: 'Pink', hex: '#ff5fa2' },
  white: { name: 'White', hex: '#f5f2ea' },
  charcoal: { name: 'Charcoal', hex: '#3a3442' },
}
export const CREATURES: Record<Creature, string> = { bear: 'Bear', cat: 'Cat', bunny: 'Bunny', blob: 'Blob', bug: 'Bug' }
export const HATS: Record<Hat, string> = {
  none: 'None',
  party: 'Party',
  beanie: 'Beanie',
  top: 'Top hat',
  crown: 'Crown',
  chef: 'Chef',
  cap: 'Cap',
  grad: 'Grad',
  wizard: 'Wizard',
  hardhat: 'Hard hat',
  headphones: 'Phones',
  headband: 'Sweatband',
  flower: 'Flower',
}
export const EXTRAS: Record<Extra, string> = { none: 'None', glasses: 'Glasses', bowtie: 'Bow tie', scarf: 'Scarf' }
/** Offered for the sign, besides typing any emoji. */
export const SIGN_EMOJIS = ['🤖', '💼', '🧬', '📚', '🛠️', '💰', '🍳', '🎧', '✈️', '🎉', '✍️', '🌱', '📬', '🏃', '🧠', '🗓️', '🛒', '🏠']

/** What a new bot looks like in the app before anything about its look is decided. */
export const UNDECIDED: Look = { creature: 'blob', color: 'cloud', hat: 'none', extra: 'none', clothes: 'purple' }

const keys = <K extends string>(parts: Record<K, unknown>) => Object.keys(parts) as K[]
const any = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]

/** A look and an emoji picked at random, for "Surprise me". */
export function surprise(): { look: Look; emoji: string } {
  return {
    look: { creature: any(keys(CREATURES)), color: any(keys(BODY_COLORS)), hat: any(keys(HATS)), extra: any(keys(EXTRAS)), clothes: any(keys(CLOTHES_COLORS)) },
    emoji: any(SIGN_EMOJIS),
  }
}

const WEARS: Record<Exclude<Hat, 'none'> | Exclude<Extra, 'none'>, string> = {
  party: 'a party hat',
  beanie: 'a beanie',
  top: 'a top hat',
  crown: 'a crown',
  chef: 'a chef’s hat',
  cap: 'a cap',
  grad: 'a graduation cap',
  wizard: 'a wizard’s hat',
  hardhat: 'a hard hat',
  headphones: 'headphones',
  headband: 'a sweatband',
  flower: 'a flower',
  glasses: 'glasses',
  bowtie: 'a bow tie',
  scarf: 'a scarf',
}

/** The look in words, such as "Cat in sky, with a cap and glasses". */
export function describeLook(look: Look): string {
  const wears = [look.hat, look.extra].flatMap((part) => (part === 'none' || !(part in WEARS) ? [] : [WEARS[part as keyof typeof WEARS]]))
  return `${CREATURES[look.creature] ?? 'Blob'} in ${(BODY_COLORS[look.color]?.name ?? 'Cloud').toLowerCase()}${wears.length ? `, with ${wears.join(' and ')}` : ''}`
}

const WHITE = '#ffffff'
const BLACK = '#000000'
const INK = '#2b2333'
const rgb = (c: string) => {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** `a` moved towards `b` by `t`. */
const mix = (a: string, b: string, t: number) => {
  const B = rgb(b)
  return '#' + rgb(a).map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const escape = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
/** A path for the left side of the face, turned into the right side. */
const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${200 - Number(x)} ${y}`)
function star(cx: number, cy: number, r: number) {
  let d = ''
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const at = i % 2 ? r * 0.45 : r
    d += `${i ? 'L' : 'M'}${(cx + at * Math.cos(a)).toFixed(1)} ${(cy + at * Math.sin(a)).toFixed(1)}`
  }
  return `<path d="${d}Z" fill="#ffe066"/>`
}

// Each part is drawn from the body's colour `c` and the clothes' colour `a`. Ears go behind the body.
const EAR: Record<Creature, (c: string, a: string) => string> = {
  bear: (c) => [56, 144].map((x) => `<circle cx="${x}" cy="56" r="18" fill="${mix(c, BLACK, 0.06)}"/><circle cx="${x}" cy="55" r="9" fill="${mix(c, '#ffc2d4', 0.5)}"/>`).join(''),
  cat: (c) => {
    const ear = 'M48 86 L56 28 L94 54Z'
    const inner = 'M60 72 L63 44 L83 56Z'
    const shade = mix(c, BLACK, 0.06)
    const pink = mix(c, '#ffc2d4', 0.5)
    return (
      [ear, mirror(ear)].map((d) => `<path d="${d}" fill="${shade}" stroke="${shade}" stroke-width="8" stroke-linejoin="round"/>`).join('') +
      [inner, mirror(inner)].map((d) => `<path d="${d}" fill="${pink}" stroke="${pink}" stroke-width="4" stroke-linejoin="round"/>`).join('')
    )
  },
  bunny: (c) =>
    [[74, -14], [126, 14]]
      .map(([x, r]) => `<g transform="rotate(${r} ${x} 34)"><ellipse cx="${x}" cy="30" rx="13" ry="32" fill="${mix(c, BLACK, 0.04)}"/><ellipse cx="${x}" cy="32" rx="6.5" ry="22" fill="${mix(c, '#ffc2d4', 0.5)}"/></g>`)
      .join(''),
  blob: (c) => `<path d="M100 50 C97 34 108 27 115 33 C120 38 113 45 108 40" stroke="${mix(c, WHITE, 0.15)}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  bug: (c, a) =>
    `<path d="M86 52 L76 20 M114 52 L124 20" stroke="${mix(c, BLACK, 0.3)}" stroke-width="4" stroke-linecap="round" fill="none"/>` +
    [76, 124].map((x) => `<circle cx="${x}" cy="18" r="7.5" fill="${a}"/><circle cx="${x - 2.5}" cy="15.5" r="2.2" fill="#ffffff" opacity="0.6"/>`).join(''),
}

const HAT: Record<Hat, (a: string) => string> = {
  none: () => '',
  party: (a) =>
    `<g transform="rotate(12 100 58)"><path d="M74 58 L100 4 L126 58 Q100 66 74 58Z" fill="${a}"/>` +
    [[90, 44, 3.6], [106, 32, 3], [110, 50, 3.4], [97, 22, 2.6], [84, 54, 2.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="0.75"/>`).join('') +
    `<circle cx="100" cy="5" r="7.5" fill="#fff4b8"/></g>`,
  beanie: (a) =>
    `<path d="M54 68 C54 16 146 16 146 68Z" fill="${a}"/><path d="M70 34 C78 27 88 23 98 22" stroke="#ffffff" stroke-opacity="0.25" stroke-width="5" stroke-linecap="round" fill="none"/>` +
    `<rect x="50" y="58" width="100" height="18" rx="9" fill="${mix(a, BLACK, 0.15)}"/>` +
    [62, 74, 86, 98, 110, 122, 134].map((x) => `<path d="M${x} 62 L${x} 72" stroke="${mix(a, BLACK, 0.32)}" stroke-width="2" stroke-linecap="round"/>`).join('') +
    `<circle cx="100" cy="19" r="11" fill="${mix(a, WHITE, 0.55)}"/>`,
  top: (a) =>
    `<g transform="rotate(-7 100 56)"><rect x="72" y="6" width="56" height="50" rx="6" fill="${INK}"/><rect x="72" y="38" width="56" height="10" fill="${a}"/>` +
    `<rect x="79" y="11" width="5" height="22" rx="2.5" fill="#ffffff" opacity="0.18"/><ellipse cx="100" cy="56" rx="46" ry="8.5" fill="${INK}"/></g>`,
  crown: (a) =>
    `<path d="M68 62 L68 28 L85 44 L100 22 L115 44 L132 28 L132 62 Q100 70 68 62Z" fill="#ffcd3c" stroke="#e6a817" stroke-width="2.5" stroke-linejoin="round"/>` +
    [[68, 27], [100, 20], [132, 27]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#ffe58f" stroke="#e6a817" stroke-width="2"/>`).join('') +
    `<circle cx="100" cy="50" r="5.5" fill="${a}"/><circle cx="82" cy="54" r="3.6" fill="${a}" opacity="0.85"/><circle cx="118" cy="54" r="3.6" fill="${a}" opacity="0.85"/>`,
  chef: () => {
    const puffs = [[76, 34, 18], [100, 22, 22], [124, 34, 18]]
    // Outlined puffs, then the same puffs again without their outline, so no line shows where they overlap.
    return (
      puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" stroke="#d9d2c7" stroke-width="2.5"/>`).join('') +
      puffs.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r - 1.3}" fill="#ffffff"/>`).join('') +
      `<rect x="68" y="36" width="64" height="26" rx="5" fill="#ffffff" stroke="#d9d2c7" stroke-width="2.5"/><rect x="69.3" y="33" width="61.4" height="7" fill="#ffffff"/>` +
      `<path d="M84 46 L84 56 M100 46 L100 56 M116 46 L116 56" stroke="#e8e2d8" stroke-width="2.5" stroke-linecap="round"/>`
    )
  },
  cap: (a) =>
    `<path d="M58 66 C58 20 142 20 142 66Z" fill="${a}"/><path d="M100 24 L100 64" stroke="${mix(a, BLACK, 0.18)}" stroke-width="2"/>` +
    `<path d="M134 58 C150 55 166 60 176 68 C166 75 148 73 134 68Z" fill="${mix(a, BLACK, 0.22)}"/>` +
    `<path d="M58 66 Q100 58 142 66" stroke="${mix(a, BLACK, 0.22)}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="100" cy="24" r="4.5" fill="${mix(a, BLACK, 0.22)}"/>` +
    `<path d="M72 40 C78 32 86 28 94 26" stroke="#ffffff" stroke-opacity="0.25" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  grad: (a) =>
    `<path d="M70 44 L70 62 Q100 72 130 62 L130 44Z" fill="${mix(INK, WHITE, 0.1)}"/><path d="M100 20 L158 36 L100 52 L42 36Z" fill="${INK}"/>` +
    `<path d="M100 36 L146 44 L146 64" stroke="${a}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M142 62 L150 62 L149 75 L143 75Z" fill="${a}"/><circle cx="100" cy="36" r="4" fill="${a}"/>`,
  wizard: (a) =>
    `<g transform="rotate(-8 100 60)"><path d="M68 60 Q88 30 94 -8 Q104 2 114 8 Q118 34 132 60Z" fill="${a}"/><ellipse cx="100" cy="60" rx="46" ry="9" fill="${mix(a, BLACK, 0.2)}"/>` +
    `${star(94, 36, 7)}${star(112, 22, 5)}${star(116, 48, 4.5)}</g>`,
  hardhat: (a) =>
    `<path d="M56 66 C56 14 144 14 144 66Z" fill="${a}"/><rect x="92" y="18" width="16" height="46" rx="8" fill="${mix(a, WHITE, 0.3)}"/>` +
    `<path d="M42 66 Q100 54 158 66 Q162 74 154 75 Q100 64 46 75 Q38 74 42 66Z" fill="${mix(a, BLACK, 0.12)}"/>` +
    `<path d="M66 44 C70 34 78 28 86 25" stroke="#ffffff" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  headphones: (a) =>
    `<path d="M36 104 C30 20 170 20 164 104" stroke="${INK}" stroke-width="9" fill="none" stroke-linecap="round"/>` +
    `<rect x="21" y="86" width="25" height="38" rx="11" fill="${a}"/><rect x="154" y="86" width="25" height="38" rx="11" fill="${a}"/><rect x="26" y="92" width="5" height="18" rx="2.5" fill="#ffffff" opacity="0.3"/>`,
  headband: (a) => `<path d="M40 84 Q100 58 160 84 L159 96 Q100 70 41 96Z" fill="${a}"/><path d="M60 80 Q100 64 140 80" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2" fill="none"/>`,
  flower: (a) =>
    `<g transform="translate(136 56) rotate(15)">${[0, 60, 120, 180, 240, 300].map((d) => `<ellipse cx="0" cy="-10" rx="6.5" ry="10" fill="${a}" transform="rotate(${d})"/>`).join('')}<circle cx="0" cy="0" r="6.5" fill="#ffd23f"/></g>`,
}

const EXTRA: Record<Extra, (a: string) => string> = {
  none: () => '',
  glasses: () =>
    `<g fill="#ffffff" fill-opacity="0.18" stroke="${INK}" stroke-width="3.2"><circle cx="80" cy="100" r="14"/><circle cx="120" cy="100" r="14"/></g>` +
    `<path d="M94 98 Q100 93 106 98" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M66 97 L42 92 M134 97 L158 92" stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  bowtie: (a) =>
    `<path d="M100 128 L84 119 Q80 128 84 137Z M100 128 L116 119 Q120 128 116 137Z" fill="${a}" stroke="${mix(a, BLACK, 0.25)}" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="100" cy="128" r="4.5" fill="${mix(a, BLACK, 0.15)}"/>`,
  scarf: (a) =>
    `<path d="M32 120 Q100 142 168 120 L167 134 Q100 156 33 134Z" fill="${a}"/><path d="M50 130 L45 164 Q52 169 60 164 L64 134Z" fill="${mix(a, BLACK, 0.12)}"/>` +
    `<path d="M48 160 L49 168 M54 161 L54 169 M60 159 L60 167" stroke="${mix(a, BLACK, 0.3)}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
}

/** Where the emoji goes, for an app that draws it itself (Skia's SVG has no emoji): its centre and size, and the sign's tilt. */
export const SIGN = { x: 100, y: 166, size: 30, angle: -5 }
/** The card the emoji is on. */
const CARD = '#fffaf1'
/**
 * The sign as a head holds it up at its corner, so bots that look alike tell apart in lists. The app
 * draws it over the head: a card with the emoji and one paw on its left edge. Each length is a share
 * of the head's width, and `right` and `bottom` reach past the head's box.
 */
export const HEAD_SIGN = { width: 0.68, height: 0.54, right: -0.15, bottom: -0.1, radius: 0.15, emoji: 0.37, paw: 0.21, angle: -6 }
/** The colours of a sign and of the paw holding it, for a body of the look's colour. */
export function signColors(look: Look): { card: string; paw: string; pawEdge: string } {
  const c = BODY_COLORS[look.color]?.hex ?? BODY_COLORS.cloud.hex
  return { card: CARD, paw: mix(c, WHITE, 0.12), pawEdge: mix(c, BLACK, 0.2) }
}
/** The square each crop shows: the whole creature, or its head for small places. */
export const VIEWS = { full: { x: 0, y: -12, width: 200, height: 224 }, head: { x: 24, y: -4, width: 152, height: 152 } }

export interface MascotOptions {
  crop?: keyof typeof VIEWS
  /** Makes the gradient's id unique among other mascots on the same page. */
  id?: string
  /** Leave the emoji out, for an app that puts it on the sign itself. */
  bare?: boolean
}

/**
 * The mascot as SVG markup to go inside an <svg> with the given viewBox. Its body is the group
 * with class "m-body" and its eyes "m-eyes", for an app that animates them.
 */
export function drawMascot(look: Look, emoji: string, { crop = 'full', id = 'mascot', bare = false }: MascotOptions = {}): { viewBox: string; body: string } {
  const c = BODY_COLORS[look.color]?.hex ?? BODY_COLORS.cloud.hex
  const a = CLOTHES_COLORS[look.clothes]?.hex ?? CLOTHES_COLORS.purple.hex
  const view = VIEWS[crop]
  const ears = (EAR[look.creature] ?? EAR.blob)(c, a)
  const hat = (HAT[look.hat] ?? HAT.none)(a)
  const extra = (EXTRA[look.extra] ?? EXTRA.none)(a)
  const sign = signColors(look)
  const body =
    `<defs><radialGradient id="${id}" cx="0.38" cy="0.3" r="0.85"><stop offset="0" stop-color="${mix(c, WHITE, 0.45)}"/><stop offset="0.55" stop-color="${c}"/><stop offset="1" stop-color="${mix(c, BLACK, 0.22)}"/></radialGradient></defs>` +
    (crop === 'full' ? '<ellipse cx="100" cy="206" rx="56" ry="6" fill="#000000" opacity="0.16"/>' : '') +
    `<g class="m-body">${ears}` +
    `<ellipse cx="72" cy="196" rx="18" ry="9" fill="${mix(c, BLACK, 0.3)}"/><ellipse cx="128" cy="196" rx="18" ry="9" fill="${mix(c, BLACK, 0.3)}"/>` +
    `<path d="M100 46 C144 46 170 80 170 126 C170 172 142 198 100 198 C58 198 30 172 30 126 C30 80 56 46 100 46Z" fill="url(#${id})"/>` +
    // The jelly's shine: a highlight up on the left, and a rim of light low on the right.
    `<ellipse cx="70" cy="76" rx="20" ry="11" transform="rotate(-35 70 76)" fill="#ffffff" opacity="0.55"/><circle cx="54" cy="98" r="4.5" fill="#ffffff" opacity="0.45"/>` +
    `<path d="M156 146 C150 170 132 186 110 191" stroke="#ffffff" stroke-opacity="0.22" stroke-width="4" stroke-linecap="round" fill="none"/>` +
    `<ellipse cx="62" cy="114" rx="9" ry="5.5" fill="#ff5c86" opacity="0.32"/><ellipse cx="138" cy="114" rx="9" ry="5.5" fill="#ff5c86" opacity="0.32"/>` +
    `<g class="m-eyes"><ellipse cx="80" cy="100" rx="7" ry="9" fill="${INK}"/><ellipse cx="120" cy="100" rx="7" ry="9" fill="${INK}"/><circle cx="82.6" cy="96.4" r="2.6" fill="#ffffff"/><circle cx="122.6" cy="96.4" r="2.6" fill="#ffffff"/></g>` +
    `<path d="M92 112 Q100 120 108 112" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" fill="none"/>` +
    extra +
    `<g transform="rotate(${SIGN.angle} ${SIGN.x} ${SIGN.y})">` +
    `<rect x="64" y="143" width="72" height="50" rx="12" fill="#000000" opacity="0.12"/>` +
    `<rect x="64" y="140" width="72" height="50" rx="12" fill="${sign.card}" stroke="#000000" stroke-opacity="0.12" stroke-width="1.5"/>` +
    (bare ? '' : `<text x="${SIGN.x}" y="${SIGN.y}" font-size="${SIGN.size}" text-anchor="middle" dominant-baseline="central" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${escape(emoji)}</text>`) +
    [64, 136].map((x) => `<circle cx="${x}" cy="166" r="11" fill="${sign.paw}" stroke="${sign.pawEdge}" stroke-width="1.2"/><circle cx="${x - 3}" cy="162" r="3" fill="#ffffff" opacity="0.5"/>`).join('') +
    `</g>${hat}</g>`
  return { viewBox: `${view.x} ${view.y} ${view.width} ${view.height}`, body }
}

/** The mascot as a whole SVG document, for an app that draws SVG from a string. It has no size of its own, so it fills whatever box it is drawn in. */
export function mascotSvg(look: Look, emoji: string, options?: MascotOptions): string {
  const { viewBox, body } = drawMascot(look, emoji, options)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`
}
