// What each voice a bot can have on a call is like, as far as is known, and the voices sorted for
// choosing: female, male, then the ones made for one language each. Codex gives the voices by name
// and nothing more (apps/server/src/calls.ts, `voices`), so what is said of them is kept here.
//
// The nine English voices are described in OpenAI's words, as ChatGPT describes them in its voice
// settings (help.openai.com, "ChatGPT Voice"). OpenAI gives no voice a gender: the ones here are how
// the voices are commonly known. The voices that came with GPT-Live-1.1 (October 2026) are each made
// for a language, and nothing is said of them but that, so they are sorted by language. A voice
// Codex offers that is not listed here, one added later, is shown by its name alone.

/** The voices Codex offers, and the one a bot has when none was chosen for it. */
export interface Voices {
  voices: string[]
  usual: string
}

/** The kinds the voices are sorted into, in the order they are shown. */
export type Shelf = 'female' | 'male' | 'language' | 'other'
export const SHELVES: readonly Shelf[] = ['female', 'male', 'language', 'other']
export const SHELF_TITLE: Record<Shelf, string> = { female: 'Female', male: 'Male', language: 'Languages', other: 'Other' }

interface Known {
  shelf: Exclude<Shelf, 'other'>
  /** OpenAI's own words for it. */
  about?: string
  /** The language it is made for. */
  language?: string
}

const KNOWN: Record<string, Known> = {
  juniper: { shelf: 'female', about: 'Open and upbeat' },
  maple: { shelf: 'female', about: 'Cheerful and candid' },
  sol: { shelf: 'female', about: 'Savvy and relaxed' },
  vale: { shelf: 'female', about: 'Bright and inquisitive' },
  marin: { shelf: 'female' },
  arbor: { shelf: 'male', about: 'Easygoing and versatile' },
  breeze: { shelf: 'male', about: 'Animated and earnest' },
  cove: { shelf: 'male', about: 'Composed and direct' },
  ember: { shelf: 'male', about: 'Confident and optimistic' },
  spruce: { shelf: 'male', about: 'Calm and affirming' },
  bubbie: { shelf: 'language', language: 'English' },
  aube: { shelf: 'language', language: 'French' },
  rivage: { shelf: 'language', language: 'French' },
  miko: { shelf: 'language', language: 'German' },
  sonna: { shelf: 'language', language: 'German' },
  leher: { shelf: 'language', language: 'Hindi' },
  neer: { shelf: 'language', language: 'Hindi' },
  himari: { shelf: 'language', language: 'Japanese' },
  rindo: { shelf: 'language', language: 'Japanese' },
  haetsal: { shelf: 'language', language: 'Korean' },
  hanul: { shelf: 'language', language: 'Korean' },
  rio: { shelf: 'language', language: 'Portuguese (Brazil)' },
  viola: { shelf: 'language', language: 'Portuguese (Brazil)' },
  tinta: { shelf: 'language', language: 'Spanish (Mexico)' },
}

/** A voice's name as people read it: "Maple". */
export const voiceName = (voice: string) => voice.charAt(0).toUpperCase() + voice.slice(1)

/** One voice, as a choice. */
export interface VoiceChoice {
  /** As Codex names it. */
  voice: string
  /** What the bot is given when this one is chosen: the usual voice is kept as none, so that it stays the usual one. */
  value: string
  name: string
  shelf: Shelf
  /** OpenAI's words for it, where there are any. */
  about: string
  /** The language it is made for, for one of those. */
  language: string
  usual: boolean
  /** The bot has it, and Codex no longer offers it. */
  gone: boolean
}

function choiceOf(voice: string, usual: string, gone: boolean): VoiceChoice {
  const known = KNOWN[voice]
  return {
    voice,
    value: voice === usual && !gone ? '' : voice,
    name: voiceName(voice),
    shelf: known?.shelf ?? 'other',
    about: known?.about ?? '',
    language: known?.language ?? '',
    usual: voice === usual,
    gone,
  }
}

/** Whether `choice` is the voice a bot given `value` has. A bot given the usual voice by name has it all the same. */
export const isVoice = (choice: VoiceChoice, value: string) => choice.value === value || choice.voice === value

/** The voices of one kind. */
export interface VoiceShelf {
  shelf: Shelf
  title: string
  voices: VoiceChoice[]
}

/**
 * The voices sorted for choosing: a shelf for each kind there are any of, in the order of
 * `SHELVES`, each by name (those made for a language by language first). `current`, the voice the
 * bot has, is among them even when Codex no longer offers it.
 */
export function shelvesOf(known: Voices, current: string): VoiceShelf[] {
  const all = known.voices.map((voice) => choiceOf(voice, known.usual, false))
  if (current && !known.voices.includes(current)) all.push(choiceOf(current, known.usual, true))
  const order = (a: VoiceChoice, b: VoiceChoice) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name)
  return SHELVES.map((shelf) => ({ shelf, title: SHELF_TITLE[shelf], voices: all.filter((choice) => choice.shelf === shelf).sort(order) })).filter((shelf) => shelf.voices.length)
}

/** What a voice is like, in a few words beside its name: "Male · Composed and direct", "French", "Female". Empty for one nothing is known of. */
export function aboutVoice(choice: VoiceChoice): string {
  if (choice.shelf === 'female' || choice.shelf === 'male') return [SHELF_TITLE[choice.shelf], choice.about].filter(Boolean).join(' · ')
  return choice.language
}

/** The voice a bot given `value` has, as a choice: the usual one for none. Null while the voices are not known. */
export function voiceOf(known: Voices | null, value: string): VoiceChoice | null {
  if (!known) return null
  const voice = value || known.usual
  if (!voice) return null
  return choiceOf(voice, known.usual, !known.voices.includes(voice))
}
