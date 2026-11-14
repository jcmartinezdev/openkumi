// What a subagent, or a run of an automation, reports to the conversation above it. The server wraps
// it in tags meant for the bot; the apps read it back out of them to show it in a line.

/** A report as the apps show it. A watch that was paused has no run, so it has no `run`. */
export type Report = {
  kind: 'subagent' | 'automation'
  name: string
  /** The thread of the subagent or the run, to open it from the report. */
  run?: string
  /** 'completed', 'failed', 'stopped', or 'paused' for a watch that could not be looked at. */
  status: string
  body: string
}

/** Reads a report out of the text the bot was given, or null for text that is not one. */
export function parseReport(text: string): Report | null {
  const m = text.match(/^<(subagent_notification|automation_result)>\n(?:Subagent|Automation) "(.*?)" \((?:id|automation): ([^\s,)]+)(?:, run: ([^\s)]+))?\) — (\w+)\n([\s\S]*)\n<\/\1>$/)
  if (!m) return null
  const [, tag, name, id, run, status, body] = m
  return tag === 'subagent_notification' ? { kind: 'subagent', name, run: id, status, body } : { kind: 'automation', name, run, status, body }
}

/** What became of it, in a word or two: "ran", "failed", "was paused". */
export const reportWord = (status: string) => (status === 'completed' ? 'ran' : status === 'paused' || status === 'stopped' ? `was ${status}` : status)
