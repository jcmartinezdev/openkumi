// What the settings are made of, by name: their pages, and every setting their search can find. The
// settings' own search (Settings.tsx) and the window's search (Palette.tsx) both find settings here.
import type { Icon } from './Icon'
import { pointAt } from './settingsUi'
import { openSettings } from './store'

export type PageId = 'profile' | 'general' | 'appearance' | 'chat' | 'providers' | 'bots' | 'superpowers' | 'prompt' | 'browser' | 'environments' | 'advanced' | 'privacy' | 'about'
export type IconName = Parameters<typeof Icon>[0]['name']

export const PAGES: Record<PageId, { label: string; icon: IconName }> = {
  profile: { label: 'Profile & devices', icon: 'person' },
  general: { label: 'General', icon: 'sliders' },
  appearance: { label: 'Appearance', icon: 'sun' },
  chat: { label: 'Chat', icon: 'message' },
  providers: { label: 'Providers', icon: 'cpu' },
  bots: { label: 'Bots', icon: 'bot' },
  superpowers: { label: 'Superpowers', icon: 'sparkles' },
  prompt: { label: 'Master prompt', icon: 'compass' },
  browser: { label: 'Browser', icon: 'globe' },
  environments: { label: 'Environments', icon: 'monitor' },
  advanced: { label: 'Advanced', icon: 'wrench' },
  privacy: { label: 'Privacy', icon: 'eye' },
  about: { label: 'About', icon: 'info' },
}

/** Every setting the search can find: the page it is on, the row to bring into view, and what it is called. */
export const SEARCH: { page: PageId; id: string; title: string; also?: string; sub?: string }[] = [
  { page: 'profile', id: 'person', title: 'Profile', also: 'person people name rename remove users family share accounts profiles someone else whose switch' },
  { page: 'profile', id: 'lan', title: 'Let other devices connect', also: 'lan remote network access sharing computers phone' },
  { page: 'profile', id: 'pair', title: 'Pair a device', also: 'code link token access connect computer phone qr' },
  { page: 'profile', id: 'paired-computers', title: 'Paired devices', also: 'remove revoke computers phones access' },
  { page: 'general', id: 'default-provider', title: 'New bots run on', also: 'default provider model' },
  { page: 'general', id: 'default-web-search', title: 'Web search for new bots' },
  { page: 'general', id: 'default-show-browser', title: 'Show the browser window for new bots', also: 'headless' },
  { page: 'general', id: 'bot-order', title: 'Order of the bots', also: 'sort sidebar list arrange drag last message recent created manual' },
  { page: 'general', id: 'confirm-delete', title: 'Confirm before deleting a conversation', also: 'chat' },
  { page: 'general', id: 'notifications', title: 'Notify me when a bot needs me', also: 'notification alert banner needs you read this attention dock badge new unread' },
  { page: 'appearance', id: 'theme', title: 'Theme', also: 'dark light mode' },
  { page: 'appearance', id: 'text-size', title: 'Message text size', also: 'font' },
  { page: 'appearance', id: 'wide', title: 'Wide conversation', also: 'width' },
  { page: 'chat', id: 'enter-sends', title: 'Enter sends the message', also: 'keyboard shortcut newline' },
  { page: 'chat', id: 'suggestions', title: 'Suggestions in a new chat' },
  { page: 'chat', id: 'expand-steps', title: 'Show the details of each step', also: 'tool calls thoughts activity' },
  { page: 'providers', id: 'provider-codex', sub: 'codex', title: 'Codex', also: 'openai chatgpt plan program path sign in' },
  { page: 'providers', id: 'provider-grok', sub: 'grok', title: 'Grok', also: 'xai grok build plan program path sign in' },
  { page: 'providers', id: 'provider-local', sub: 'local', title: 'Local models', also: 'ollama lm studio offline private free' },
  { page: 'providers', id: 'provider-claude-code', sub: 'claude-code', title: 'Claude Code', also: 'anthropic claude plan program path sign in' },
  { page: 'providers', id: 'provider-openai-compatible', sub: 'openai-compatible', title: 'Other models', also: 'api key base url ollama openrouter' },
  { page: 'bots', id: 'bots', title: 'Bots', also: 'rules model delete new bot workspace files memory instructions agents.md changes history' },
  { page: 'bots', id: 'bot-messages', title: 'Bots can message each other', also: 'messages between bots talk work together pass hand over' },
  { page: 'prompt', id: 'team', title: 'What each bot is for', also: 'description team hand over handoff delegate other bots' },
  { page: 'prompt', id: 'told', title: 'What a bot is told', also: 'master prompt system prompt principles instructions behaviour behavior all bots preview read' },
  { page: 'browser', id: 'browser-program', title: 'Browser program', also: 'chrome edge chromium' },
  { page: 'browser', id: 'browser-panel', title: 'Open the panel when a bot starts browsing' },
  { page: 'browser', id: 'browsers-running', title: 'Browsers running now', also: 'stop' },
  { page: 'superpowers', id: 'superpowers', title: 'Superpowers', also: 'plugins skills apps tools productivity work creative marketing travel everyday notion linear atlassian jira confluence todoist granola otter readwise typefully evernote clickup miro fathom tldv attio folk pocketsmith webflow wix jotform klaviyo posthog sentry t3 code coding agents pandadoc crm forms analytics websites meetings finance documents errors weather exchange rates currency holidays watch seo social posts launch landing pages competitors sign in' },
  { page: 'environments', id: 'local-environment', title: 'Local environment', also: 'run on this computer server' },
  { page: 'environments', id: 'remote-environments', title: 'Other computers', also: 'remote environments add another computer connect server lan' },
  { page: 'advanced', id: 'max-steps', title: 'Steps per turn', also: 'limit' },
  { page: 'advanced', id: 'max-subagents', title: 'Subagents at once', also: 'limit parallel' },
  { page: 'advanced', id: 'max-depth', title: 'Subagent levels', also: 'depth nested' },
  { page: 'advanced', id: 'instructions-limit', title: 'Size of a bot’s own instructions', also: 'agents.md limit' },
  { page: 'advanced', id: 'history-limit', title: 'Length of a conversation', also: 'context window summary tokens history' },
  { page: 'advanced', id: 'debug-engines', title: 'Log what the engines print', also: 'debug troubleshooting' },
  { page: 'advanced', id: 'data-folder', title: 'Data folder', also: 'files location' },
  { page: 'advanced', id: 'delete-chats', title: 'Delete all conversations', also: 'chats history' },
  { page: 'privacy', id: 'telemetry', title: 'Send how OpenKumi is used and what goes wrong', also: 'telemetry analytics usage errors crash reports tracking data posthog privacy id' },
  { page: 'about', id: 'version', title: 'Version' },
  { page: 'about', id: 'alpha', title: 'Alpha', also: 'early preview beta report problem bug issue feedback github' },
  { page: 'about', id: 'app-update', title: 'Updates', also: 'update check new version restart upgrade download app server' },
  { page: 'about', id: 'server-auto-update', title: 'Update by itself', also: 'automatic auto update server upgrade' },
]

export type SettingFound = (typeof SEARCH)[number]

/** The settings that have every word: in their name, the words they are also found by, or their page's name. */
export function findSettings(words: string[]): SettingFound[] {
  return SEARCH.filter((s) => words.every((w) => `${s.title} ${s.also ?? ''} ${PAGES[s.page].label}`.toLowerCase().includes(w)))
}

/** Opens the page a setting is on, with the setting in view and lit. */
export function goToSetting(result: SettingFound) {
  pointAt(result.id)
  // Some settings are on a part of their page that has an address of its own, such as one provider.
  openSettings(result.page, ...(result.sub ? [result.sub] : []))
  // The page may already be showing, in which case its rows do not mount again. One that is still
  // on its way (the settings were closed) lights its row itself as it mounts.
  requestAnimationFrame(() => {
    const row = document.getElementById(result.id)
    if (!row) return void setTimeout(() => pointAt(null), 2000)
    row.scrollIntoView({ block: 'center' })
    row.classList.add('found')
    pointAt(null)
  })
}
