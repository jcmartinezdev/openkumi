// What a bot is doing, in a few plain words, from the tool call it made. Shown the same way in every app.

export function parse(json: string): Record<string, any> {
  try {
    return JSON.parse(json) ?? {}
  } catch {
    return {}
  }
}

export const site = (url: unknown) => String(url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

/** A short human description of a tool call, e.g. "Open example.com". */
export function describe(call: { name: string; arguments: string }): string {
  const a = parse(call.arguments)
  switch (call.name) {
    case 'browser_navigate': return `Open ${site(a.url)}`
    case 'browser_snapshot': return 'Look at the page'
    case 'browser_click': return 'Click on the page'
    case 'browser_type': return `Type “${String(a.text ?? '').slice(0, 60)}”`
    case 'browser_select': return `Select “${a.option ?? ''}”`
    case 'browser_press_key': return `Press ${a.key ?? ''}`
    case 'browser_scroll': return `Scroll ${a.direction ?? ''}`
    case 'browser_back': return 'Go back'
    case 'browser_read': return 'Read the page'
    case 'browser_eval': return 'Run a script in the page'
    case 'web_fetch': return `Fetch ${site(a.url)}`
    case 'spawn_subagent': return `Start subagent “${a.name ?? ''}”`
    case 'wait_subagents': return 'Wait for subagents'
    case 'list_subagents': return 'Check on subagents'
    case 'read_subagent': return 'Read a subagent’s progress'
    case 'message_subagent': return 'Message a subagent'
    case 'cancel_subagent': return 'Stop a subagent'
    case 'browser_upload': return `Attach ${a.path ?? 'a file'}`
    case 'list_scheduled_tasks': return 'Check scheduled tasks'
    case 'schedule_task': return `Schedule “${a.title ?? ''}”`
    case 'update_scheduled_task': return a.paused === true ? 'Pause a scheduled task' : a.paused === false ? 'Resume a scheduled task' : 'Change a scheduled task'
    case 'delete_scheduled_task': return 'Delete a scheduled task'
    case 'create_bot': return `Create bot “${a.name ?? ''}”`
    case 'list_bots': return 'List bots'
    case 'list_files': return `Look in ${a.path || 'its folder'}`
    case 'read_file': return String(a.path ?? '').startsWith('skills/') ? `Read the skill “${String(a.path).split('/')[1]}”` : `Read ${a.path ?? 'a file'}`
    case 'write_file':
    case 'edit_file':
      // The bot changing how it will behave from now on is worth saying plainly.
      return a.path === 'AGENTS.md' ? 'Update its own instructions' : String(a.path ?? '').startsWith('memory/') ? `Save a note in ${a.path}` : `${call.name === 'edit_file' ? 'Edit' : 'Write'} ${a.path ?? 'a file'}`
    case 'search_files': return `Search its files for “${a.query ?? ''}”`
    case 'move_file': return `Move ${a.from ?? ''} to ${a.to ?? ''}`
    case 'delete_file': return `Delete ${a.path ?? 'a file'}`
    default: {
      // Tools from a connection are named mcp__<connection>__<tool>.
      const [, connection, tool] = call.name.match(/^mcp__(.+?)__(.+)$/) ?? []
      return connection ? `${connection}: ${tool.replace(/_/g, ' ')}` : call.name
    }
  }
}
