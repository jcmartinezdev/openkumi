---
title: Tools available to a bot
description: "Every tool a bot can call, and where each one is withheld: subagents, automation runs, calls and messages from other bots."
---

| Area | Tools |
| --- | --- |
| Bots | `list_bots`, `message_bot`, `create_bot` (the main assistant only) |
| Files | `list_files`, `read_file`, `write_file`, `edit_file`, `search_files`, `move_file`, `delete_file` |
| Its conversation | `search_history`, `read_history` |
| Subagents | `spawn_subagent`, `wait_subagents`, `list_subagents`, `read_subagent`, `message_subagent`, `cancel_subagent` |
| Automations | `list_automations`, `create_automation`, `update_automation`, `delete_automation` |
| Browser | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select`, `browser_upload`, `browser_press_key`, `browser_scroll`, `browser_back`, `browser_read`, `browser_eval`, `browser_ask_user` |
| Web | `web_fetch`, plus the engine's own web search on Codex, Claude Code and Grok (when the bot's **Web search** is on) |
| The conversation | `show_page` |
| Superpowers | every tool of the services its superpowers bring, named `mcp__<superpower>__<tool>` |

There is no tool for running commands. A bot's file tools reach its own workspace and, to read
only, the files of its superpowers; nothing else on the computer (see [What a bot can
reach](/security/bots/)). Each tool's result is cut at 40,000 characters.

## Where tools are withheld

A bot does not have every tool everywhere:

| Where the bot is | What it does not have |
| --- | --- |
| Its conversation, answering you | nothing is withheld; `create_bot` only for the main assistant, and only right after you asked |
| Its conversation, answering another bot | `create_bot`; `message_bot` reaches only the bot that wrote, and only if it asked for a reply |
| A subagent | `message_bot`, `create_bot`; at the last level of subagents, the subagent tools |
| A run of an automation | `message_bot`, `create_bot`, `browser_ask_user` (nobody is watching) |
| A turn that answers something asked on a call | everything but `list_bots`, `message_bot`, `create_bot`, the subagent tools (but `wait_subagents`) and the automation tools; automations it makes must start at a time. No web search. |
| Any thread, when **Bots can message each other** is off | `message_bot`, and `create_bot`'s first message |

## A few in more detail

- **Subagents.** A subagent is the bot itself, at work on a part of the job in a thread of its own;
  to give work to another bot, a bot messages it. Subagents can nest two levels deep unless you
  change it, and each gets its own browser window. See [Subagents](/how-it-works/subagents/).
- **`create_bot`.** Only the main assistant (the first bot) can create a bot, in its own
  conversation, and only in answer to something you said: not when another bot, a subagent's
  report or an automation's run woke it. A new bot runs on what new bots run on (**Settings →
  General**), and `create_bot` can give it a first message, which it starts on at once in its own
  conversation.
- **The browser while you have control.** While you have control of a window, the bot's
  `browser_snapshot` and `browser_read` still work, and everything else in that window is refused
  at once, with a note saying so; the next result after you hand back tells it you used the window.
- **`browser_ask_user`** shows what the bot needs ("Sign in to LinkedIn") on the window, with
  **Take control** and **Not now**, and returns when you hand back, say no, or after 25 minutes. A
  subagent's or a run's window closes a minute after it finishes.
- **`web_fetch`** fetches `http` and `https` addresses, following up to eight redirects, and refuses
  OpenKumi's own address on this computer.
- **`show_page`** shows a self-contained HTML page in the conversation. See [Replies and
  pages](/how-it-works/replies-and-pages/).
- **Superpower tools** come from each superpower's MCP server, connected with the bot's own
  sign-in when they are first needed. A service that cannot be reached is named in what the bot is
  told, with why, so it can tell you.
