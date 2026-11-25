// The window's search (⌘K, or Search at the top of the sidebar): the bots, what can be done in the
// chat that is showing, places, every setting, superpowers, automations, conversations, what was
// said in them, and whose bots to show. Picking something opens it, or does it. Settings are
// opened, never changed from here, and nothing is sent to a bot from here: the composer is for that.
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Bot, HistoryMatch, PalettePick, Thread } from '@openkumi/shared'
import { shownName } from '@openkumi/shared/people'
import { attentionOf } from '@openkumi/client/attention'
import { useBotOrder } from '@openkumi/client/bots'
import { call, useCalling } from '@openkumi/client/calls'
import { type Findable, type Ranked, fold, rank, wordsOf } from '@openkumi/client/search'
import { note } from '@openkumi/client/telemetry'
import { type ChatAction, askChat } from './chatActions'
import { desktop, useDesktop } from './desktop'
import { day } from './History'
import { Icon } from './Icon'
import { BotHead } from './Mascot'
import { type IconName, PAGES, type PageId, SEARCH, goToSetting } from './settingsSearch'
import { withCommand } from './shortcuts'
import { BotMark, ago } from './Sidebar'
import { Tile } from './Superpowers'
import { Avatar } from './Switcher'
import { USAGE_ADDRESS, api, mainThread, openAutomations, openSettings, useStore } from './store'

/** A level opened from the first: all about one bot, a bot's earlier conversations, or whose bots to show. */
type Level = { kind: 'bot'; botId: string } | { kind: 'earlier'; botId: string } | { kind: 'people' }

interface Entry extends Findable {
  key: string
  group: string
  kind: PalettePick
  lead: ReactNode
  /** A second line under its name. */
  detail?: ReactNode
  /** What its row ends with. */
  meta?: ReactNode
  /** The level that Tab opens (and Enter, but for a bot). */
  into?: Level
  /** What Enter does, as the bar along the bottom says it. */
  verb?: string
  run?: () => void
}

/** The groups, in the order they come in when they match equally well. */
const ORDER = ['bots', 'chat', 'things', 'places', 'commands', 'settings', 'superpowers', 'automations', 'conversations']
/** The few things done most in the chat that is showing, listed before anything is typed. */
const AT_HAND = ['call', 'fresh', 'earlier', 'browser']

// What was picked lately, on this computer: listed before anything is typed, and moved up a little when it matches.
const RECENT = 'openkumi.palette.recent'
function recentKeys(): string[] {
  try {
    const keys: unknown = JSON.parse(localStorage.getItem(RECENT) ?? '[]')
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}
function remember(key: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([key, ...recentKeys().filter((k) => k !== key)].slice(0, 12)))
  } catch {
    // Nothing kept: the search works the same without it.
  }
}

/** `text` with the words typed in bold. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const pattern = new RegExp(`(${[...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu')
  return <>{text.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>
}

const icon = (name: IconName) => <Icon name={name} />
const failed = (e: Error) => alert(e.message)

interface Props {
  close: () => void
  /** The bot whose conversation is showing, when one is. */
  current?: Bot
  /** Its browser is showing beside its conversation. */
  browserOpen: boolean
  /** Opens a bot's conversation with its browser beside it. */
  openBrowser: (botId: string) => void
  /** Opens a bot's conversation, or one of its threads at a message, and brings it into view (its browser may be filling the window). */
  openChat: (botId: string, threadId?: string, itemId?: number) => void
  newBot: () => void
}

export function Palette({ close, current, browserOpen, openBrowser, openChat, newBot }: Props) {
  const { bots } = useBotOrder()
  const threads = useStore((s) => s.threads)
  const browsers = useStore((s) => s.browsers)
  const queue = useStore((s) => s.queue)
  const automations = useStore((s) => s.automations)
  const superpowers = useStore((s) => s.superpowers)
  const calls = useStore((s) => s.calls)
  const calling = useCalling()
  const app = useDesktop()
  const [query, setQuery] = useState('')
  const [levels, setLevels] = useState<Level[]>([])
  /** The row picked with the keys or the pointer, by its key: rows the server adds later do not move it. None is the first. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /** What the server found for what is typed, once it has answered: what was said, and threads by their title. */
  const [said, setSaid] = useState<{ matches: HistoryMatch[]; threads: Thread[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  /** Something was picked, which takes the keyboard where it goes. */
  const picked = useRef(false)
  const recent = useMemo(recentKeys, [])

  const level = levels.at(-1)
  const onlyThingsToDo = !level && query.trimStart().startsWith('>')
  const words = wordsOf(onlyThingsToDo ? query.trimStart().slice(1) : query)
  const typed = words.length > 0
  const botOf = (id: string) => bots.find((b) => b.id === id)

  // The keyboard is the search's while it is open, and goes back where it was when it closes unused.
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => void (!picked.current && before?.isConnected && before.focus({ preventScroll: true }))
  }, [])

  // The server is asked a moment after the typing stops: for what was said, across every bot's
  // conversations or the opened-up bot's, and for the threads whose title has the words, which the
  // list here holds only the recent subagents and runs of.
  const sayingBot = level?.kind === 'bot' ? level.botId : ''
  const askServer = typed && !onlyThingsToDo && (!level || level.kind === 'bot')
  // A title is found by a single letter; what was said is not, as nearly every message has it.
  const showSaid = askServer && words.join('').length >= 2
  const asked = query.trim()
  useEffect(() => {
    setSaid(null)
    if (!askServer) return
    let stale = false
    const wait = setTimeout(() => {
      api<{ matches: HistoryMatch[]; threads?: Thread[] }>('GET', `/api/search?q=${encodeURIComponent(asked)}${sayingBot ? `&bot=${encodeURIComponent(sayingBot)}` : ''}`).then(
        (found) => !stale && setSaid({ matches: found.matches.slice(0, 5), threads: found.threads ?? [] }),
        // A server from before this search has nothing to add.
        () => !stale && setSaid({ matches: [], threads: [] }),
      )
    }, 200)
    return () => ((stale = true), clearTimeout(wait))
  }, [asked, askServer, sayingBot])
  const searching = askServer && said === null

  // ---- what there is to find

  // Done in the bot's conversation in view (a subagent's thread too), or in its own conversation, opened for it.
  const chat = (botId: string, action: ChatAction) => void (askChat(botId, action) || openChat(botId))

  /** What can be done with a bot: under its name when it is opened up, or for the chat that is showing. */
  function botActions(b: Bot, opened: boolean): Entry[] {
    const group = opened ? 'things' : 'chat'
    const main = mainThread(threads, b.id)
    const entries: Entry[] = []
    const add = (id: string, entry: Omit<Entry, 'key' | 'group' | 'kind'>) => entries.push({ key: `action:${b.id}:${id}`, group, kind: 'action', ...entry })
    // The chat that is showing is open already.
    if (opened) add('open', { title: 'Open the conversation', keywords: 'chat talk', lead: icon('message'), run: () => openChat(b.id) })
    if (calls.available && !(calling.phase !== 'off' && calling.botId === b.id)) {
      add('call', { title: opened ? 'Call' : `Call ${b.name}`, keywords: 'voice phone speak talk', lead: icon('phone'), verb: 'Call', run: () => (openChat(b.id), void call(b.id)) })
    }
    if (main && main.status !== 'running') {
      add('fresh', {
        title: 'Start fresh',
        keywords: 'new conversation clear reset empty',
        detail: 'The conversation so far is kept among the earlier ones',
        lead: icon('compose'),
        verb: 'Start fresh',
        run: () => void api('POST', `/api/bots/${b.id}/fresh`).then(() => openChat(b.id), failed),
      })
    }
    if (threads.some((t) => t.botId === b.id && !t.parentId && t.archivedAt)) {
      add('earlier', { title: 'Earlier conversations', keywords: 'history past archive old set aside', lead: icon('history'), into: { kind: 'earlier', botId: b.id } })
    }
    if (!(b.id === current?.id && browserOpen)) add('browser', { title: 'Show the browser', keywords: 'window web page pane', lead: icon('globe'), verb: 'Show', run: () => openBrowser(b.id) })
    add('model', { title: 'Change the model', keywords: 'reasoning effort engine provider', lead: icon('cpu'), run: () => chat(b.id, 'model') })
    add('attach', { title: 'Send files…', keywords: 'attach upload document picture photo', lead: icon('file'), verb: 'Choose', run: () => chat(b.id, 'attach') })
    const bots = <span className="palette-meta">Settings › Bots</span>
    add('settings', { title: opened ? 'Bot settings' : `${b.name}’s settings`, keywords: 'rules name emoji look description voice', lead: icon('sliders'), meta: bots, run: () => openSettings('bots', b.id) })
    add('superpowers', { title: opened ? 'Superpowers' : `${b.name}’s superpowers`, keywords: 'plugins skills apps tools', lead: icon('sparkles'), meta: bots, run: () => openSettings('bots', b.id, 'superpowers') })
    add('files', { title: opened ? 'Files' : `${b.name}’s files`, keywords: 'workspace agents.md memory documents folder', lead: icon('folder'), meta: bots, run: () => openSettings('bots', b.id, 'workspace') })
    add('automation', { title: opened ? 'New automation' : `New automation for ${b.name}`, keywords: 'schedule task watch every repeat', lead: icon('clock'), run: () => openAutomations('new', b.id) })
    return entries
  }

  const botEntries = (): Entry[] =>
    bots.map((b, i) => ({
      key: `bot:${b.id}`,
      group: 'bots',
      kind: 'bot',
      title: b.name,
      keywords: b.description,
      // What it is for, when that is what was found.
      detail: typed && !words.every((w) => fold(b.name).includes(w)) ? <Marked text={b.description} words={words} /> : undefined,
      lead: <BotHead bot={b} />,
      meta: (
        <>
          <BotMark attention={attentionOf(b.id, { threads, browsers, queue })} />
          {i < 9 && <kbd>{withCommand(String(i + 1))}</kbd>}
        </>
      ),
      into: { kind: 'bot', botId: b.id },
      run: () => openChat(b.id),
    }))

  const places = (): Entry[] => {
    const on = automations.filter((a) => a.enabled).length
    return [
      { key: 'place:automations', group: 'places', kind: 'place', title: 'Automations', keywords: 'scheduled tasks schedule watch webhooks triggers runs', lead: icon('clock'), meta: on ? <span className="palette-meta">{on} on</span> : undefined, run: () => openAutomations() },
      { key: 'place:usage', group: 'places', kind: 'place', title: 'Usage', keywords: 'tokens cost limits plan spend models', lead: icon('chart'), run: () => void (location.hash = USAGE_ADDRESS) },
      { key: 'place:settings', group: 'places', kind: 'place', title: 'Settings', keywords: 'preferences options', lead: icon('sliders'), meta: <kbd>{withCommand(',')}</kbd>, run: () => openSettings() },
    ]
  }

  const everyone = (app.local.enabled ? Math.max(1, app.local.people?.length ?? 0) : 0) + app.environments.filter((e) => e.enabled).length
  const commands = (): Entry[] => [
    { key: 'command:new-bot', group: 'commands', kind: 'command', title: 'New bot…', keywords: 'create add make', lead: icon('plus'), run: newBot },
    { key: 'command:new-automation', group: 'commands', kind: 'command', title: 'New automation…', keywords: 'create schedule task watch every', lead: icon('clock'), run: () => openAutomations('new') },
    ...(everyone > 1 ? [{ key: 'command:people', group: 'commands', kind: 'command' as const, title: 'Show another person’s bots…', keywords: 'switch people person computer environment whose family', lead: icon('person'), into: { kind: 'people' as const } }] : []),
  ]

  const settings = (): Entry[] => [
    // A setting called what its page is called is that page.
    ...SEARCH.filter((s) => s.title !== PAGES[s.page].label).map(
      (s): Entry => ({
        key: `setting:${s.id}`,
        group: 'settings',
        kind: 'setting',
        title: s.title,
        keywords: `${s.also ?? ''} ${PAGES[s.page].label}`,
        lead: icon(PAGES[s.page].icon),
        meta: <span className="palette-meta">Settings › {PAGES[s.page].label}</span>,
        run: () => goToSetting(s),
      }),
    ),
    ...(Object.keys(PAGES) as PageId[]).map(
      (id): Entry => ({
        key: `page:${id}`,
        group: 'settings',
        kind: 'setting',
        title: PAGES[id].label,
        keywords: `settings page ${SEARCH.filter((s) => s.page === id && s.title === PAGES[id].label).map((s) => s.also ?? '').join(' ')}`,
        lead: icon(PAGES[id].icon),
        meta: <span className="palette-meta">Settings</span>,
        run: () => openSettings(id),
      }),
    ),
  ]

  /** The superpowers; for a bot that is opened up, as it has them. */
  const powers = (bot?: Bot): Entry[] =>
    superpowers.map((p) => {
      const names = p.onFor.map((id) => botOf(id)?.name).filter(Boolean)
      return {
        key: `superpower:${p.id}`,
        group: 'superpowers',
        kind: 'superpower',
        title: p.name,
        keywords: `${p.tagline} ${p.categories.join(' ')} ${p.service ?? ''}`,
        detail: p.tagline,
        lead: <Tile power={p} size="row" />,
        meta: bot ? p.onFor.includes(bot.id) && <span className="pill good">On</span> : names.length > 0 && <span className="palette-meta">On for {names.join(', ')}</span>,
        run: () => (bot ? openSettings('bots', bot.id, 'superpowers', p.id) : openSettings('superpowers', p.id)),
      }
    })

  const automationEntries = (botId?: string): Entry[] =>
    automations
      .filter((a) => !botId || a.botId === botId)
      .map((a) => {
        const owner = botOf(a.botId)?.name
        return { key: `automation:${a.id}`, group: 'automations', kind: 'automation', title: a.title, owner, detail: [owner, a.enabled ? '' : 'Off'].filter(Boolean).join(' · '), lead: icon('clock'), run: () => openAutomations(a.id) }
      })

  /** Every thread but the bots' own conversations: earlier ones, subagents, and the runs of automations, newest first. */
  const conversations = (botId?: string): Entry[] =>
    [...threads, ...(said?.threads.filter((t) => !threads.some((held) => held.id === t.id)) ?? [])]
      .filter((t) => (t.parentId || t.archivedAt) && (!botId || t.botId === botId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => {
        const owner = botOf(t.botId)?.name
        const what = t.kind === 'automation' ? 'Run of an automation' : t.parentId ? 'Subagent' : 'Earlier conversation'
        return {
          key: `thread:${t.id}`,
          group: 'conversations',
          kind: 'conversation',
          title: t.title,
          owner,
          detail: owner ? `${what} · ${owner}` : what,
          lead: icon(t.kind === 'automation' ? 'clock' : t.parentId ? 'agents' : 'history'),
          meta: <span className="time">{ago(t.updatedAt)}</span>,
          run: () => openChat(t.botId, t.id),
        }
      })

  const earlier = (botId: string): Entry[] =>
    threads
      .filter((t) => t.botId === botId && !t.parentId && t.archivedAt)
      .sort((a, b) => b.archivedAt! - a.archivedAt!)
      .map((t) => ({ key: `thread:${t.id}`, group: 'earlier', kind: 'conversation', title: t.title, lead: icon('history'), meta: <span className="time">{day(t.createdAt)}</span>, run: () => openChat(botId, t.id) }))

  /** Whose bots to show: everyone on this computer, then the other computers (as the switcher lists them). */
  const people = (): Entry[] => {
    const { local } = app
    const here = local.enabled ? (local.people ?? []) : []
    const check = <Icon name="check" size={15} />
    const show = (id: string, person?: string) => () => void desktop.open(id, person).catch(() => {})
    const entries: Entry[] = here.map((name) => ({
      key: `person:local:${name}`,
      group: 'here',
      kind: 'person',
      title: shownName(name),
      lead: <Avatar name={shownName(name)} size={22} />,
      meta: app.current === 'local' && local.person === name && check,
      verb: 'Show',
      run: show('local', name),
    }))
    if (local.enabled && !here.length) entries.push({ key: 'person:local', group: 'here', kind: 'person', title: 'This computer', lead: icon('monitor'), meta: app.current === 'local' && check, verb: 'Show', run: show('local') })
    for (const e of app.environments.filter((e) => e.enabled)) {
      entries.push({ key: `person:${e.id}`, group: 'elsewhere', kind: 'person', title: e.name, lead: <Avatar name={e.person ? shownName(e.person) : e.name} size={22} />, meta: app.current === e.id && check, verb: 'Show', run: show(e.id) })
    }
    entries.push({ key: 'person:add', group: 'elsewhere', kind: 'command', title: 'Connect to another computer…', keywords: 'add pair environment remote', lead: icon('plus'), run: () => openSettings('environments', 'add') })
    return entries
  }

  /** The search through the conversations, as rows. */
  const saidEntries = (): Entry[] =>
    (said?.matches ?? []).map((m) => {
      const botId = m.botId ?? sayingBot
      const b = botOf(botId)
      const to = b?.name ?? 'a bot'
      const who = m.from === 'bot' ? to : m.from === 'user' ? `You, to ${to}` : m.from === 'other' ? `${m.name ?? 'Another bot'}, to ${to}` : m.from === 'automation' ? `An automation, to ${to}` : `A subagent, to ${to}`
      return {
        key: `message:${m.itemId}`,
        group: 'messages',
        kind: 'message',
        title: who,
        detail: <Marked text={m.snippet} words={words} />,
        lead: b ? <BotHead bot={b} /> : icon('message'),
        meta: <span className="time">{day(m.createdAt)}</span>,
        run: () => openChat(botId, m.threadId, m.itemId),
      }
    })

  /** Groups as the entries come, for a list nothing was typed into. */
  const asListed = (entries: Entry[]): Ranked<Entry>[] => {
    const groups: Ranked<Entry>[] = []
    for (const entry of entries) {
      const group = groups.find((g) => g.group === entry.group)
      if (group) group.things.push(entry)
      else groups.push({ group: entry.group, things: [entry] })
    }
    return groups
  }

  let groups: Ranked<Entry>[]
  const find = (entries: Entry[], order: string[] = ORDER) => (typed ? rank(entries, words, { order, recent, keep: selectedKey }) : asListed(entries))
  const opened = level && level.kind !== 'people' ? botOf(level.botId) : undefined
  if (level?.kind === 'people') groups = find(people(), ['here', 'elsewhere'])
  else if (level?.kind === 'earlier') groups = typed ? rank(earlier(level.botId), words, { order: [], recent, perGroup: 50 }) : asListed(earlier(level.botId))
  else if (level?.kind === 'bot') {
    groups = opened ? find([...botActions(opened, true), ...automationEntries(opened.id), ...conversations(opened.id), ...powers(opened).filter((p) => typed || opened.superpowers.includes(p.key.slice('superpower:'.length)))], ['things', 'automations', 'conversations', 'superpowers']) : []
  } else if (onlyThingsToDo) groups = find([...(current ? botActions(current, false) : []), ...places(), ...commands()])
  else if (typed) groups = find([...botEntries(), ...(current ? botActions(current, false) : []), ...places(), ...commands(), ...settings(), ...powers(), ...automationEntries(), ...conversations()])
  else {
    // Before anything is typed: the bots, what is at hand in the chat that is showing, places, and what was picked lately.
    const lately = new Map([...settings(), ...powers(), ...automationEntries(), ...conversations(), ...commands()].map((e) => [e.key, e]))
    const recents = recent.flatMap((key) => (lately.has(key) ? [{ ...lately.get(key)!, group: 'recent' }] : [])).slice(0, 3)
    const atHand = current ? botActions(current, false).filter((a) => AT_HAND.includes(a.key.split(':')[2])) : []
    groups = asListed([...botEntries(), ...atHand, ...places(), ...recents])
  }
  if (showSaid && said?.matches.length) groups = [...groups, { group: 'messages', things: saidEntries() }]
  const entries = groups.flatMap((g) => g.things)
  const found = selectedKey === null ? -1 : entries.findIndex((e) => e.key === selectedKey)
  const at = Math.max(0, found)
  // The first row, once it shows as picked, stays the one picked: what the server adds a moment later goes around it.
  useEffect(() => {
    if (found < 0 && entries[0]) setSelectedKey(entries[0].key)
  })
  const chosen = entries[at] as Entry | undefined

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at, query, levels.length])

  const enter = (next: Level) => (setLevels([...levels, next]), setQuery(''), setSelectedKey(null))
  const back = () => (setLevels(levels.slice(0, -1)), setQuery(''), setSelectedKey(null))
  const pick = (entry: Entry | undefined) => {
    if (!entry) return
    if (entry.into && entry.kind !== 'bot') return enter(entry.into)
    if (!entry.run) return
    remember(entry.key)
    note({ event: 'palette used', picked: entry.kind, typed })
    picked.current = true
    close()
    entry.run()
  }

  const heading = (group: string): ReactNode => {
    if (group === 'chat' && current) {
      return (
        <>
          <BotHead bot={current} sign={false} /> {current.name} · the chat you’re in
        </>
      )
    }
    const names: Record<string, string> = {
      bots: 'Bots',
      things: 'Things to do',
      places: 'Go to',
      commands: 'Do',
      settings: 'Settings',
      superpowers: 'Superpowers',
      automations: 'Automations',
      conversations: 'Conversations',
      earlier: 'Earlier conversations',
      recent: 'Recent',
      here: 'On this computer',
      elsewhere: 'Other computers',
      messages: 'In messages',
    }
    return names[group] ?? group
  }

  const placeholder = level?.kind === 'bot' ? 'Search in this bot' : level?.kind === 'earlier' ? 'Find a conversation' : level?.kind === 'people' ? 'Find a person or a computer' : 'Search bots, settings, superpowers, messages…'
  let i = 0
  return (
    <>
      <div className="palette-scrim" onMouseDown={close} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-main">
          <label className="palette-search">
            {level ? (
              <span className="palette-level">
                {level.kind === 'people' ? (
                  <span>Whose bots</span>
                ) : (
                  opened && (
                    <>
                      <BotHead bot={opened} sign={false} />
                      <span>{opened.name}</span>
                      {level.kind === 'earlier' && <span className="faint">› Earlier</span>}
                    </>
                  )
                )}
              </span>
            ) : (
              <Icon name="search" size={17} />
            )}
            <input
              ref={input}
              value={query}
              placeholder={placeholder}
              aria-label="Search"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={chosen ? `palette-${at}` : undefined}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => (setQuery(e.target.value), setSelectedKey(null))}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (entries.length) setSelectedKey(entries[(at + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length].key)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  pick(chosen)
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  if (chosen?.into) enter(chosen.into)
                } else if (e.key === 'Backspace' && !query && levels.length) {
                  e.preventDefault()
                  back()
                } else if (e.key === 'Escape') {
                  // Only the search closes, not what it is over (the settings close on Escape too).
                  e.preventDefault()
                  e.stopPropagation()
                  close()
                }
              }}
            />
          </label>
          <div className="palette-list" id="palette-list" role="listbox" aria-label="Found" ref={list} onMouseDown={(e) => e.preventDefault()}>
            {groups.map((g) => (
              <div key={g.group} role="group" aria-label={g.group === 'chat' ? 'The chat you’re in' : String(heading(g.group))}>
                <div className="palette-group" aria-hidden>{heading(g.group)}</div>
                {g.things.map((entry) => {
                  const n = i++
                  return (
                    <div
                      key={entry.key}
                      id={`palette-${n}`}
                      role="option"
                      aria-selected={n === at}
                      className={`palette-row ${n === at ? 'selected' : ''}`}
                      onMouseMove={() => n !== at && setSelectedKey(entry.key)}
                      onClick={() => pick(entry)}
                    >
                      <span className="palette-lead">{entry.lead}</span>
                      <span className="palette-text">
                        <span className="palette-title"><Marked text={entry.title} words={entry.kind === 'message' ? [] : words} /></span>
                        {entry.detail && <span className="palette-detail">{entry.detail}</span>}
                      </span>
                      {entry.meta && <span className="palette-end">{entry.meta}</span>}
                      {entry.into && entry.kind !== 'bot' && <Icon name="chevron" size={14} />}
                    </div>
                  )
                })}
              </div>
            ))}
            {!entries.length && !searching && <p className="palette-empty">{typed ? 'Nothing has all of these words.' : level?.kind === 'earlier' ? 'No earlier conversations.' : 'Nothing here yet.'}</p>}
          </div>
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
          {chosen && <span><kbd>↵</kbd> {chosen.into && chosen.kind !== 'bot' ? 'Show' : (chosen.verb ?? 'Open')}</span>}
          {chosen?.kind === 'bot' && <span><kbd>Tab</kbd> More</span>}
          {levels.length > 0 && <span><kbd>⌫</kbd> Back</span>}
          <span className="grow" />
          {searching ? (
            <span><span className="spinner" /> Searching messages…</span>
          ) : (
            <span><kbd>esc</kbd> Close</span>
          )}
        </div>
      </div>
    </>
  )
}
