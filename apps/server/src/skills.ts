// Skills are folders with a SKILL.md (the same format Claude Code and Codex use). The catalog in
// ~/.openbot/skills is shared; switching a skill on for a bot puts a link to it in that bot's
// skills folder, so the folder listing is the whole truth about what a bot may use.
import fs from 'node:fs'
import path from 'node:path'
import type { Skill } from '@openbot/shared'
import { ROOT, SKILLS, botDir, emit } from './config.ts'
import { parseFrontMatter } from './frontmatter.ts'

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** Marks a catalog folder as a copy of a skill that ships with Open Bot. */
const BUNDLED = '.bundled'
const links = (botId: string) => path.join(botDir(botId), 'skills')

function readSkill(name: string): Skill | undefined {
  if (!NAME.test(name)) return
  const dir = path.join(SKILLS, name)
  let text: string
  try {
    text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return
  }
  const { data, body } = parseFrontMatter(text)
  const firstLine = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? ''
  // SKILL.md names are identifiers like "deep-research"; show them as words.
  const title = (data.name || name).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
  return {
    name,
    title,
    description: (data.description || firstLine).slice(0, 600),
    bundled: fs.existsSync(path.join(dir, BUNDLED)),
  }
}

export function listSkills(): Skill[] {
  return fs
    .readdirSync(SKILLS)
    .sort()
    .map(readSkill)
    .filter((s): s is Skill => !!s)
}

/** Refreshes the catalog's copies of the skills that ship with Open Bot. Skills the user added are left alone. */
export function syncBundledSkills() {
  const source = path.join(ROOT, 'skills')
  if (!fs.existsSync(source)) return
  for (const name of fs.readdirSync(source)) {
    if (!NAME.test(name) || !fs.existsSync(path.join(source, name, 'SKILL.md'))) continue
    const dest = path.join(SKILLS, name)
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, BUNDLED))) continue
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(path.join(source, name), dest, { recursive: true })
    fs.writeFileSync(path.join(dest, BUNDLED), '')
  }
}

/** The skills switched on for a bot: the links in its skills folder that still lead to a catalog skill. */
export function enabledSkills(botId: string): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(links(botId))
  } catch {
    return []
  }
  return names.filter((name) => fs.existsSync(path.join(links(botId), name, 'SKILL.md')) && !!readSkill(name)).sort()
}

export function setSkill(botId: string, name: string, on: boolean) {
  if (!readSkill(name)) throw new Error(`There is no skill named "${name}" in the catalog.`)
  const link = path.join(links(botId), name)
  // Whatever is there now (a stale or broken link) goes first; lstat sees links that lead nowhere.
  const existing = fs.lstatSync(link, { throwIfNoEntry: false })
  // Only the link is removed, never the catalog skill it points at.
  if (existing?.isSymbolicLink()) fs.unlinkSync(link)
  else if (existing) fs.rmSync(link, { recursive: true, force: true })
  if (!on) return
  fs.mkdirSync(links(botId), { recursive: true })
  const target = path.join(SKILLS, name)
  // Relative, so the link survives the data folder being moved. Windows needs an absolute junction.
  if (process.platform === 'win32') fs.symlinkSync(target, link, 'junction')
  else fs.symlinkSync(path.relative(links(botId), target), link, 'dir')
}

/** What a bot is told about its skills: one line each, with where to read the rest. */
export function skillIndex(botId: string): string[] {
  return enabledSkills(botId).flatMap((name) => {
    const skill = readSkill(name)
    return skill ? [`- ${skill.title}: ${skill.description} (skills/${name}/SKILL.md)`] : []
  })
}

export function announceSkills() {
  emit({ type: 'skills', skills: listSkills() })
}
