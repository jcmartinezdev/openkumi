// What every app does to a reply before handing it to its Markdown reader.

/**
 * Formulas set on lines of their own ($$ … $$ or \[ … \]) become ```math blocks, so that each app
 * can draw them where it draws code blocks. Code blocks themselves are left alone, and so is a
 * formula that is still being written (it is turned once its end arrives).
 */
export function fenceMath(text: string): string {
  if (!text.includes('$$') && !text.includes('\\[')) return text
  const lines = text.split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (marker) {
      fence = marker
      out.push(line)
      continue
    }
    const trimmed = line.trim()
    // $$ x $$ (or \[ x \]) on one line.
    const single = /^\$\$(.+)\$\$$/.exec(trimmed) ?? /^\\\[(.+)\\\]$/.exec(trimmed)
    if (single) {
      out.push('```math', single[1].trim(), '```')
      continue
    }
    const close = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\]' : null
    const end = close ? lines.findIndex((l, j) => j > i && l.trim().endsWith(close)) : -1
    if (!close || end === -1) {
      out.push(line)
      continue
    }
    const body = [trimmed.slice(2), ...lines.slice(i + 1, end), lines[end].trim().slice(0, -2)].map((l) => l.trim()).filter(Boolean)
    out.push('```math', ...body, '```')
    i = end
  }
  return out.join('\n')
}
