// Small helpers shared by the diagram components. Diagrams are drawn at build time as plain SVG,
// coloured only through CSS variables (src/styles/diagrams.css), so they follow light and dark mode
// and need nothing at all in the reader's browser.

export type Point = [number, number]

/** About how wide a line of text is at this size, in Inter. SVG cannot measure text at build time. */
export const textWidth = (text: string, size = 13) => {
  let width = 0
  for (const ch of text) {
    if (/[A-Z@%&MW]/.test(ch)) width += 0.68
    else if (/[il.,:;'|!()[\]{}`/ ]/.test(ch)) width += 0.32
    else if (/[mw]/.test(ch)) width += 0.82
    else if (/[0-9]/.test(ch)) width += 0.6
    else width += 0.55
  }
  return width * size
}

export const asLines = (text?: string | string[]) => (text === undefined ? [] : Array.isArray(text) ? text : [text])

/** The point a fraction of the way along a path, and the direction of the segment it is on. */
export function along(points: Point[], t: number): { at: Point; dx: number; dy: number } {
  const segments = points.slice(1).map((p, i) => {
    const [x0, y0] = points[i]
    return { from: points[i], to: p, length: Math.hypot(p[0] - x0, p[1] - y0) }
  })
  const total = segments.reduce((sum, s) => sum + s.length, 0)
  let left = total * t
  for (const s of segments) {
    if (left <= s.length || s === segments[segments.length - 1]) {
      const f = s.length ? Math.min(1, left / s.length) : 0
      const dx = s.to[0] - s.from[0]
      const dy = s.to[1] - s.from[1]
      return { at: [s.from[0] + dx * f, s.from[1] + dy * f], dx, dy }
    }
    left -= s.length
  }
  return { at: points[0], dx: 1, dy: 0 }
}

/** An arrowhead at `tip`, pointing the way from `from`: a filled triangle as SVG points. */
export function head(from: Point, tip: Point, length = 9, half = 4.5): string {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  const back: Point = [tip[0] - length * Math.cos(angle), tip[1] - length * Math.sin(angle)]
  const left: Point = [back[0] + half * Math.sin(angle), back[1] - half * Math.cos(angle)]
  const right: Point = [back[0] - half * Math.sin(angle), back[1] + half * Math.cos(angle)]
  return [tip, left, right].map(([x, y]) => `${round(x)},${round(y)}`).join(' ')
}

/** A point moved `by` back along the line from `from`, so a line stops where its arrowhead starts. */
export function pullBack(from: Point, tip: Point, by: number): Point {
  const length = Math.hypot(tip[0] - from[0], tip[1] - from[1])
  if (!length) return tip
  const f = Math.max(0, (length - by) / length)
  return [from[0] + (tip[0] - from[0]) * f, from[1] + (tip[1] - from[1]) * f]
}

export const round = (n: number) => Math.round(n * 10) / 10

export const pathOf = (points: Point[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ')
