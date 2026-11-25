// The superpowers that ship with the app, read when the site is built from the server's own folder
// of them (apps/server/superpowers), so the website lists exactly what the app offers. The site
// calls them integrations where people look for that word, and superpowers, as the app does,
// everywhere else.
import type { MarkdownInstance } from 'astro'
import order from '../../../server/superpowers/categories.json'

interface Manifest {
  name: string
  categories?: string[]
  tagline: string
  can: string[]
  /** The app's own service, which the bot signs in to. Know-how has none. */
  mcp?: { url: string }
  site?: string
  hooks?: { events: { id: string; name: string }[] }
}

export interface Superpower {
  /** Its folder's name, which is its address on the site: /integrations/<id>. */
  id: string
  name: string
  tagline: string
  categories: string[]
  can: string[]
  /** Works in an app, which the bot signs in to with an account of its own. */
  app: boolean
  /** Where the app's service is, for an app. */
  service: string | null
  /** The app runs on the same computer as the bots (T3 Code), rather than on the web. */
  local: boolean
  site: string | null
  /** What the app can call a bot's webhook about. */
  hooks: string[]
  /** The icon, as a data: address for an <img>. */
  icon: string | null
  /** Its page in the app (README.md), which says what to ask it and how it is set up; one may have none, as in the app. */
  Content: MarkdownInstance<Record<string, never>>['Content'] | null
}

const manifests = import.meta.glob<Manifest>('../../../server/superpowers/*/superpower.json', { eager: true, import: 'default' })
const icons = import.meta.glob<string>('../../../server/superpowers/*/icon.svg', { eager: true, query: '?raw', import: 'default' })
const readmes = import.meta.glob<MarkdownInstance<Record<string, never>>>('../../../server/superpowers/*/README.md', { eager: true })

export const superpowers: Superpower[] = Object.entries(manifests)
  .map(([file, m]) => {
    const folder = file.slice(0, -'superpower.json'.length)
    const icon = icons[`${folder}icon.svg`]
    return {
      id: folder.split('/').at(-2)!,
      name: m.name,
      tagline: m.tagline,
      categories: m.categories ?? [],
      can: m.can,
      app: !!m.mcp,
      service: m.mcp ? new URL(m.mcp.url).host : null,
      local: !!m.mcp && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(m.mcp.url).hostname),
      site: m.site ?? null,
      hooks: m.hooks?.events.map((e) => e.name) ?? [],
      icon: icon ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon)}` : null,
      Content: readmes[`${folder}README.md`]?.Content ?? null,
    }
  })
  .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

/** The groups the app's catalog has, in its order, with how many are in each. */
export const groups = (order as string[])
  .map((name) => ({ name, count: superpowers.filter((p) => p.categories.includes(name)).length }))
  .filter((group) => group.count)

export const apps = superpowers.filter((p) => p.app)
export const knowHow = superpowers.filter((p) => !p.app)
