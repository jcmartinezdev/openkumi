---
title: Settings and configuration
description: "What each settings page holds, which settings belong to the device and which to the server, and the environment variables the server reads."
---

## Settings

Everything is set from the Settings page, which saves each change as you make it. The search box at
its top finds any setting by name. Each page has **Restore defaults**.

| Page | What it holds |
| --- | --- |
| **General** | **New bots**: what they run on, whether they have web search, whether their browser window is shown. **Confirm before deleting a conversation**. |
| **Appearance** | theme (light, dark or the system's), message text size, a wide conversation |
| **Chat** | whether **Enter sends the message**, suggestions in a new chat, how much detail a step shows |
| **Providers** | Codex, Claude Code, Grok, local models and other models: whether each is connected, its program path or address, and **Use … for bots**. See [What bots run on](/setup/providers/). |
| **Bots** | every bot, and each bot's page: what it is for, its rules, model, web search, browser, voice, look, superpowers, automations and workspace. **Bots can message each other**. See [Making and shaping a bot](/setup/bots/). |
| **Superpowers** | every superpower, what each does, which bots have it, and webhooks. See [Superpowers](/superpowers/). |
| **Master prompt** | what each bot is for, and everything a bot is told, to read. See [What every bot is told](/how-it-works/what-a-bot-is-told/). |
| **Browser** | the browser program the bots drive, whether the live view opens when a bot starts browsing, and which bots have a browser running now |
| **Environments** | the local environment, remote environments, **Let other computers connect**, **Pair a computer**, the paired computers, and **People on this computer**. See [Other computers and your phone](/environments/). |
| **Advanced** | **Steps per turn**, **Subagents at once**, **Subagent levels**, **Size of a bot's own instructions**, **Length of a conversation**, **Log what the engines print**, the data folder, **Delete all conversations** |
| **Privacy** | **Send how OpenKumi is used and what goes wrong**, this computer's id, and everything that was sent. See [Usage and error reports](/telemetry/). |
| **About** | the version of the app and of the environment it shows, their updates, **Update by itself** for a server installed alone, and a note on the alpha |

**Appearance**, **Chat** and **Confirm before deleting a conversation** belong to the device: each
computer and phone keeps its own. Everything else belongs to the environment, and is the same from
every device connected to it. The environment keeps its settings in `settings.json` in its data folder
(`~/.openkumi/people/<name>/`), which holds only the values that differ from the defaults. Where
several people have bots on one computer, each one's server has settings of its own.

### The limits in Advanced

| Setting | Default | Range | What it limits |
| --- | --- | --- | --- |
| Steps per turn | 80 | 5 to 500 | steps a bot on a local model or an API takes in one turn |
| Subagents at once | 8 | 1 to 16 | subagents one thread can have at work at the same time |
| Subagent levels | 2 | 0 to 3 | how deep subagents can nest beneath a conversation |
| Size of a bot's own instructions | 12,000 characters | 2,000 to 60,000 | how much of `AGENTS.md` a bot is told each step |
| Length of a conversation | 60,000 tokens | 2,000 to 1,000,000 | how much conversation a local model or an API is sent before the older part is summarised |

## Environment variables

The server reads these when it starts. Where one names something Settings also sets, the variable
wins.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENKUMI_PORT` | `4317`; `4417` run from a clone of the repository | the first person's server's port. Everyone else's is written in `~/.openkumi/people.json` |
| `OPENKUMI_HOOKS_PORT` | the server's port plus one | the port webhook calls are taken on, on this computer only. Like `OPENKUMI_PORT`, it is about the first person's server |
| `OPENKUMI_NAME` | your account's name | what the first person is called, when the first start on this computer makes them (the desktop app sets it to the name its welcome was given) |
| `OPENKUMI_LAN` | unset | `1` lets other computers on the network connect whatever Settings says (same as `--lan`) |
| `OPENKUMI_HOME` | `~/.openkumi`; `~/.openkumi-dev` run from a clone of the repository | the folder everything is kept in: each person's data folder is `people/<name>/` in it |
| `OPENKUMI_BROWSER_CHANNEL` | from Settings | the browser program: `chrome`, `msedge`, or `chromium` for the one that comes with OpenKumi |
| `OPENKUMI_CLAUDE_BIN`, `OPENKUMI_CODEX_BIN`, `OPENKUMI_GROK_BIN` | from Settings, else found on `PATH` | where the `claude`, `codex` and `grok` programs are |
| `OPENKUMI_TAILSCALE_BIN` | the Tailscale app, else `tailscale` on `PATH` | the Tailscale program, asked for this computer's name on Tailscale |
| `OPENKUMI_DEBUG` | from Settings | `1` logs everything an engine prints |
| `OPENKUMI_RELEASES_URL` | this project's releases on GitHub | where a server installed alone, and its installer, look for versions |
| `OPENKUMI_DESKTOP_UPDATES_URL` | this project's releases on GitHub | another place for the desktop app to look for versions of itself |
| `OPENKUMI_TELEMETRY` | from Settings | `0` stops the server telling OpenKumi's makers anything, whatever Settings says (see [Usage and error reports](/telemetry/)); `DO_NOT_TRACK=1` does the same |
| `OPENKUMI_TELEMETRY_URL`, `OPENKUMI_TELEMETRY_KEY` | PostHog in the EU, OpenKumi's project | another place and project for those reports to go, for testing; with these set a server run from the source sends too |
| `OPENKUMI_PRICES_URL` | LiteLLM's public list on GitHub | another address for the list of model prices that [Usage](/using/usage/) goes by; set to nothing, the list is never fetched, and only what Claude Code prices itself has a cost |
| `OPENKUMI_MOCK` | unset | `1` turns on the scripted offline provider the tests use |

The desktop app also reads `OPENKUMI_PORT` and `OPENKUMI_HOME`, to find or start the local server.
Run from a clone of the repository, it keeps its own data apart as well: in an `OpenKumi Dev`
folder beside the installed app's `OpenKumi`, unless `OPENKUMI_DESKTOP_DATA` names another.
