// Models as bots name them, loosely ("haiku", "opus 5.5"), among those of every provider that is
// ready to use: for an automation's own model, and for the model a bot runs on.
import type { Bot, Effort, ModelInfo, RunsOn } from '@openkumi/shared'
import { EFFORTS } from './bots.ts'
import { getProvider, listModels, providerInfos } from './providers/index.ts'

export type ModelLists = { id: string; name: string; models: ModelInfo[] }[]

/** A name as it is compared: its letters and digits alone, so that "opus 5.5" finds "Claude Opus 5.5". */
const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The models every provider that is ready to use offers, those of the provider `first` first. */
export async function readyModels(first: string): Promise<ModelLists> {
  const ready = providerInfos().filter((p) => p.connected && p.enabled !== false)
  // Asked for now rather than as last heard: a model may have been added since.
  const lists = await Promise.all(ready.map(async (p) => ({ id: p.id, name: p.name, models: await listModels(getProvider(p.id)).catch(() => []) })))
  return lists.sort((a, b) => Number(b.id === first) - Number(a.id === first))
}

/**
 * The model a bot named, by its name or its id, among those of every provider that is ready. A name
 * that fits exactly comes before one that only contains what was written, a model of the first
 * provider listed before another's, and a model's latest version before an earlier one. A name
 * that fits none is answered with the models there are, and `or`, what else may be given.
 */
export function modelCalled(name: string, lists: ModelLists, or = ''): { provider: string; info: ModelInfo } {
  const want = plain(name)
  for (const exact of [true, false]) {
    for (const list of want ? lists : []) {
      const fits = (text: string) => (exact ? plain(text) === want : plain(text).includes(want))
      const found = list.models.filter((m) => fits(m.id) || fits(m.name))
      const info = found.find((m) => !m.older) ?? found[0]
      if (info) return { provider: list.id, info }
    }
  }
  const there = lists.map((list) => `${list.name}: ${list.models.filter((m) => !m.older).map((m) => (m.name === m.id ? m.id : `${m.name} (${m.id})`)).join(', ')}`)
  throw new Error(`No model is called "${name}". There are these. ${there.join('. ')}.${or ? ` ${or}` : ''}`)
}

/**
 * What is kept of a model that was named: its id, also when it is its provider's default just now.
 * One its provider itself only calls "default" is kept as no model, which is the same thing.
 */
export const keptAs = ({ provider, info }: ReturnType<typeof modelCalled>) => ({ provider, model: /^default$/i.test(info.id) ? '' : info.id })

/** The levels of reasoning a model takes: its provider's first when none is named. */
export function effortsOf(on: Pick<RunsOn, 'provider' | 'model'>, lists: ModelLists): string[] {
  const models = lists.find((list) => list.id === on.provider)?.models ?? []
  return (on.model ? models.find((m) => m.id === on.model) : models[0])?.efforts ?? EFFORTS.slice(1)
}

const named = (value: unknown) => typeof value === 'string' && value.trim() !== ''

/**
 * What a bot is to run on, from a model and a level of reasoning named loosely, either one left
 * out: undefined when neither was given, and the level alone when no model was. A model alone
 * keeps the bot's level of reasoning where it takes that level, as the model picker does;
 * "default" is the model's own level.
 */
export async function engineFor(bot: Bot, model: unknown, effort: unknown): Promise<Partial<Pick<Bot, 'provider' | 'model' | 'effort'>> | undefined> {
  if (!named(model) && !named(effort)) return undefined
  const lists = await readyModels(bot.provider)
  const on = named(model) ? keptAs(modelCalled(String(model), lists)) : { provider: bot.provider, model: bot.model }
  const takes = effortsOf(on, lists)
  // Without a model of its own, only the level is written: the model may have been changed meanwhile.
  const at = (level: Effort) => (named(model) ? { ...on, effort: level } : { effort: level })
  if (!named(effort)) return at(takes.includes(bot.effort) ? bot.effort : '')
  const level = String(effort).trim().toLowerCase()
  if (level === 'default') return at('')
  if (!takes.includes(level)) throw new Error(takes.length ? `effort is one of ${takes.join(', ')} for that model, or "default".` : 'That model has no levels of reasoning: leave effort out.')
  return at(level as Effort)
}
