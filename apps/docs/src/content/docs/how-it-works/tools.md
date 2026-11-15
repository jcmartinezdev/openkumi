---
title: Tools available to a bot
description: "Every tool a bot can call, and who may use which."
---

| Area | Tools |
| --- | --- |
| Bots | `list_bots`, `message_bot` (in its own conversation), `create_bot` (the main assistant, in its own conversation) |
| Files | `list_files`, `read_file`, `write_file`, `edit_file`, `search_files`, `move_file`, `delete_file` |
| Its conversation | `search_history`, `read_history` |
| Subagents | `spawn_subagent`, `wait_subagents`, `list_subagents`, `read_subagent`, `message_subagent`, `cancel_subagent` |
| Automations | `list_automations`, `create_automation`, `update_automation`, `delete_automation` |
| Browser | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select`, `browser_upload`, `browser_press_key`, `browser_scroll`, `browser_back`, `browser_read`, `browser_eval`, `browser_ask_user` |
| Web | `web_fetch`, plus the provider's built-in web search |
| The conversation | `show_page` |
| Superpowers | every tool of the services its superpowers bring, named `mcp__<superpower>__<tool>` |

There is no shell tool.

A subagent is the bot itself, at work on a part of the job in a thread of its own; to give work
to another bot, a bot messages it (see [Messages between bots](/how-it-works/messages-between-bots/)). Subagents can nest two levels
deep; each gets its own browser window.

Only the main assistant (the first bot) can create a bot, in its own conversation, and only in
answer to something you said: not when another bot, a subagent's report or an automation's run woke
it. A new bot runs on what new bots run on (**Settings → General**), and `create_bot` can give it
a first message, which it starts on at once in its own conversation.

While you have control of a window, the bot's `browser_snapshot` and `browser_read` still work, and
everything else in that window is refused at once, with a note saying so; the next result after you
hand back tells it you used the window. `browser_ask_user` shows what the bot needs ("Sign in to
LinkedIn") on the window, with **Take control** and **Not now**, and returns when you hand back,
say no, or after 25 minutes. Runs of automations do not have it, since nobody watches them. A
subagent's or a run's window closes a minute after it finishes.
