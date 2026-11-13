// OpenKumi's own mascot: the look every first bot is given (apps/server/src/index.ts), holding a
// sign with the robot that was the app's icon before it. The robot is drawn rather than an emoji,
// so the icons made from it (scripts/icons.mjs) carry no emoji font's artwork.
import type { Look } from '@openkumi/shared'
import { SIGN, drawMascot, mascotSvg } from '@openkumi/client/mascot'

export const KUMI: Look = { creature: 'bear', color: 'sky', hat: 'headphones', extra: 'none', clothes: 'orange' }

/** The old icon's robot, small, on the mascot's sign. */
const ROBOT =
  `<g transform="rotate(${SIGN.angle} ${SIGN.x} ${SIGN.y})">` +
  `<path d="M100 157 L100 151" stroke="#2b2333" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="150" r="3.2" fill="#2b2333"/>` +
  `<rect x="83" y="156" width="34" height="22" rx="7.5" fill="#1d1c22"/>` +
  `<rect x="86.5" y="159.5" width="27" height="15" rx="4.5" fill="none" stroke="#f4f4f5" stroke-width="2"/>` +
  `<circle cx="94" cy="167" r="2.9" fill="#4ade80"/><circle cx="106" cy="167" r="2.9" fill="#4ade80"/>` +
  `</g>`

/** The mascot as SVG markup for inside an <svg> with the given viewBox. */
export function drawKumi(id = 'kumi', crop: 'full' | 'head' = 'full'): { viewBox: string; body: string } {
  const { viewBox, body } = drawMascot(KUMI, '', { id, crop, bare: true })
  return { viewBox, body: crop === 'full' ? body + ROBOT : body }
}

/** The mascot as a whole SVG document. */
export function kumiSvg(id = 'kumi', crop: 'full' | 'head' = 'full'): string {
  const { viewBox, body } = drawKumi(id, crop)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`
}

export { mascotSvg }
