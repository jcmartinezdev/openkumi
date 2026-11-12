// The small subset of YAML front matter that bot.md files use: top-level
// `key: value` pairs, quoted strings, and folded or literal blocks. No dependency needed.

export interface Parsed {
  data: Record<string, string>
  body: string
}

export function parseFrontMatter(text: string): Parsed {
  const match = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return { data: {}, body: text }
  const data: Record<string, string> = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/)
    if (!pair) continue
    const [, key, raw] = pair
    // Indented lines that follow belong to this key (a block, or a wrapped value).
    const more: string[] = []
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && more.length))) more.push(lines[++i].trim())
    const block = /^[>|][+-]?$/.test(raw.trim())
    if (block) data[key] = more.join(raw.trim().startsWith('|') ? '\n' : ' ').trim()
    else data[key] = [unquote(raw.trim()), ...more].join(' ').trim()
  }
  return { data, body: text.slice(match[0].length) }
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) return value.slice(1, -1).replace(/''/g, "'")
  return value
}

export function formatFrontMatter(data: Record<string, string | boolean | number>, body: string): string {
  const lines = Object.entries(data).map(([key, value]) => {
    // Quote anything YAML could read as something other than the plain string it is.
    const plain = typeof value !== 'string' || /^[^\s"'#:>|\-\[\]{}&*!%@`,?][^#:\n]*$/.test(value) && !/^(true|false|null|~|[\d.+-]+)$/i.test(value) && value === value.trim()
    return `${key}: ${plain ? value : JSON.stringify(value)}`
  })
  return `---\n${lines.join('\n')}\n---\n${body.trim() ? `\n${body.trim()}\n` : ''}`
}
