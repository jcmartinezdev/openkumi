---
title: Usage and error reports
description: "What OpenKumi tells the people who make it, what it never does, and how to switch it off."
---

<!-- Written by apps/docs/scripts/telemetry.mjs from apps/server/src/telemetry-events.ts. Change it there, then run the script. -->

OpenKumi keeps your bots, their files and everything you say to them on your own computer. There is
one thing it asks to send to the people who make it: how it is used, and where it breaks. This page
says all of what that is.

## The short of it

- **You are asked first.** The first time an app connects to a computer that runs your bots, it asks
  whether that computer may send this. The box is ticked; nothing is sent until you have answered,
  and a no means nothing is ever sent.
- **Only the computer that runs your bots sends anything.** The desktop app and the phone app
  record a little about themselves (that they were opened, which screens, never what a screen
  shows) and hand it to that computer, which checks it and sends it under the same answer. They
  send nothing themselves, and nothing at all while they have no computer to hand it to.
- **Never what you or your bots write.** No message, no file, no name of a bot, a file or an
  automation, no address, no sign-in, and nothing from a bot's browser. What can be sent is the list
  at the end of this page, and each value is checked against that list before it leaves.
- **A random id, not you.** Each computer that agrees gets a random id, so that what it sends can be
  told apart from what another sends. It is not made from anything about you or the computer.
  Where several people have bots on one computer, each one's server is asked, answers and has an
  id on its own.
- **It goes to PostHog**, a company that stores this kind of data, on its servers in the EU, which
  is set not to keep the address it came from. It is sent to `pulse.openkumi.ai`, an address of
  OpenKumi's that PostHog answers at.

## Switching it on or off

- In the app: **Settings → Privacy**. It is a setting of the server that runs your bots, so it is
  the same from every app that uses it.
- On a computer without the app: `openkumi telemetry on` or `openkumi telemetry off`. Without
  either word it says how things stand. `--for <name>` after it is about someone else's server
  there.
- Where the server is started: `OPENKUMI_TELEMETRY=0` or `DO_NOT_TRACK=1` in its environment
  switches it off whatever the setting says, and the apps then do not ask.

Switching it off throws the id away and drops whatever had not been sent yet. Switched on again,
the computer starts over with a new id. A server run from the source code sends nothing at all.

## Reading what was sent

**Settings → Privacy** lists each thing that was sent, exactly as it went, and shows the id, with a
button for a new one. The same list is kept in `logs/telemetry.ndjson` in the data folder, a line per
event, for the last few hundred.

## Errors

When something goes wrong in the server, what is sent is the kind of error (such as `TypeError`)
and the trail through OpenKumi's own code that led to it: file, function and line, as they are in
the public source. The error's message is never sent, since a message can hold a path, an address
or something you wrote, and neither is any step of the trail outside OpenKumi's code. An error
that keeps happening is sent at most ten times a day. A crash is written down as the server ends
and sent the next time it starts.

For something that goes wrong in the desktop app or the phone app, less is sent: the kind of error
and where in the app's own program it happened, as a file, a line and a column.

## Everything that can be sent

### With every event

| Name | What it can be | What it says |
| --- | --- | --- |
| `version` | A version, such as `0.0.1` | The version of OpenKumi the server is. |
| `how` | One of `app`, `installed`, `source` | How the server runs: inside the desktop app, installed on its own, or from its source. |
| `os` | One of `darwin`, `linux`, `win32`, `other` | The kind of computer: a Mac, Linux or Windows. |
| `arch` | One of `arm64`, `x64`, `other` | The kind of processor. |

PostHog also notes when each event arrived and, from the address it came from, the country. The
address itself is not kept.

## What the server records

### server started

Each time the server starts.

| Name | What it can be | What it says |
| --- | --- | --- |
| `updated_from` | A version, such as `0.0.1` | The version it ran as before, when this start is the first of a new one. |

### daily summary

Once a day, and when the server starts on a day it has not sent one.

| Name | What it can be | What it says |
| --- | --- | --- |
| `bots` | A whole number | How many bots there are. |
| `conversations` | A whole number | How many conversations there are. |
| `automations_time` | A whole number | How many automations run at set times. |
| `automations_watch` | A whole number | How many automations watch something. |
| `automations_hook` | A whole number | How many automations are started by a webhook. |
| `superpowers` | A list of names from OpenKumi’s own code or catalog | Which superpowers of the catalog are switched on for at least one bot. |
| `engines` | A list of names from OpenKumi’s own code or catalog | Which engines the bots run on. |
| `paired` | A whole number | How many other computers and phones are paired. |
| `lan` | Yes or no | Whether other computers on the network may connect. |
| `public_address` | Yes or no | Whether an address for webhooks has been set. The address itself is not sent. |

### app connected

When an app connects, at most once a day for each app.

| Name | What it can be | What it says |
| --- | --- | --- |
| `app` | One of `desktop`, `iphone`, `other` | Which app. |
| `app_version` | A version, such as `0.0.1` | The version of the app. |
| `app_os` | One of `macos`, `windows`, `linux`, `ios`, `android`, `other` | What the app runs on. |
| `local` | Yes or no | Whether the app is on the same computer as the server. |

### message sent

When a bot is given something to read.

| Name | What it can be | What it says |
| --- | --- | --- |
| `from` | One of `user`, `parent`, `subagent`, `trigger`, `automation`, `bot` | Who it is from: you, a bot handing work to a subagent, a subagent reporting back, an automation starting or reporting, or another bot. |
| `engine` | One of `codex`, `claude-code`, `grok`, `local`, `openai-compatible`, `other` | The engine the bot runs on. |
| `attachments` | A whole number | How many files came with it. |
| `on_call` | Yes or no | Whether it was said on a call. |

### run finished

When a bot has worked through what was waiting for it.

| Name | What it can be | What it says |
| --- | --- | --- |
| `engine` | One of `codex`, `claude-code`, `grok`, `local`, `openai-compatible`, `other` | The engine the bot runs on. |
| `outcome` | One of `done`, `stopped`, `failed` | Whether it finished, was stopped, or failed. |
| `seconds` | A whole number | How long it took. |
| `steps` | A whole number | How many times the model was asked. |
| `error` | A name from OpenKumi’s own code or catalog | When it failed: the place in OpenKumi’s code where it did, such as “src/agent.ts:turn”. |

### tokens used

When a bot has worked through what was waiting for it, once for each model it used.

| Name | What it can be | What it says |
| --- | --- | --- |
| `engine` | One of `codex`, `claude-code`, `grok`, `local`, `openai-compatible`, `other` | The engine the bot runs on. |
| `model` | A name from OpenKumi’s own code or catalog | The model, as its maker names it, such as “claude-opus-5-5”. For a local model, or one reached at an address you gave, only “local” or “other”: what such a model is called is yours. |
| `input_tokens` | A whole number | How many tokens the model was sent, as whatever runs it counts them. |
| `cached_tokens` | A whole number | How many of those were read from a cache. |
| `output_tokens` | A whole number | How many tokens the model wrote. |
| `total_tokens` | A whole number | The two together: what it was sent and what it wrote. |

### tool failed

When a tool a bot called came back with an error.

| Name | What it can be | What it says |
| --- | --- | --- |
| `tool` | A name from OpenKumi’s own code or catalog | The tool, when it is one of OpenKumi’s own. For a tool of a superpower, only “service”. |
| `superpower` | A name from OpenKumi’s own code or catalog | For a tool of a superpower: which superpower of the catalog. |
| `error` | A name from OpenKumi’s own code or catalog | The place in OpenKumi’s code where it failed. |

### bot created

When a bot is made.

| Name | What it can be | What it says |
| --- | --- | --- |
| `by` | One of `user`, `bot`, `server` | Whether you made it, a bot did, or it is the first bot, which the server makes itself. |
| `engine` | One of `codex`, `claude-code`, `grok`, `local`, `openai-compatible`, `other` | The engine it runs on. |

### bot deleted

When a bot is deleted. It carries nothing of its own.

### superpower switched

When a superpower is switched on or off for a bot.

| Name | What it can be | What it says |
| --- | --- | --- |
| `superpower` | A name from OpenKumi’s own code or catalog | Which superpower of the catalog. |
| `on` | Yes or no | On or off. |

### automation created

When an automation is made.

| Name | What it can be | What it says |
| --- | --- | --- |
| `trigger` | One of `time`, `watch`, `hook` | What starts it: the clock (“time”), a change in something it watches, or a webhook (“hook”). |
| `by` | One of `user`, `bot` | Whether you made it or a bot did. |

### automation ran

When a run of an automation is over.

| Name | What it can be | What it says |
| --- | --- | --- |
| `trigger` | One of `time`, `watch`, `hook` | What started it: the clock (“time”), a change in something it watches, or a webhook (“hook”). |
| `outcome` | One of `done`, `failed` | Whether it finished or failed. |

### call ended

When a call with a bot is over.

| Name | What it can be | What it says |
| --- | --- | --- |
| `seconds` | A whole number | How long it lasted. |
| `failed` | Yes or no | Whether it ended because something went wrong. |

### browser taken over

When you take control of a bot’s browser window. It carries nothing of its own.

### error (`$exception`)

When something goes wrong in the server: a run fails, something in the background fails, or the server crashes (sent the next time it starts).

| Name | What it can be | What it says |
| --- | --- | --- |
| `where` | One of `run`, `background`, `crash` | What failed: a bot’s run, something the server does in the background, or the server itself. |
| `error` | A name from OpenKumi’s own code or catalog | The place in OpenKumi’s code where it failed. |
| `type` | A name from OpenKumi’s own code or catalog | The kind of error, such as “TypeError”. |
| `frames` | A list of names from OpenKumi’s own code or catalog | The trail through OpenKumi’s own code that led there: file, function and line. Not the error’s message, and nothing from outside OpenKumi’s code. |

## What the apps record

These are recorded by the desktop app or the phone app, and handed to the computer that runs your
bots to send. Each also carries which app it came from:

| Name | What it can be | What it says |
| --- | --- | --- |
| `app` | One of `desktop`, `iphone`, `other` | Which app. |
| `app_version` | A version, such as `0.0.1` | The version of the app. |
| `app_os` | One of `macos`, `windows`, `linux`, `ios`, `android`, `other` | What the app runs on. |

### app opened

When an app is opened, once it has reached a server.

| Name | What it can be | What it says |
| --- | --- | --- |
| `first` | Yes or no | Whether it is the first time the app was opened on that computer or phone. |

### welcome answered

When a way to start is chosen on the app’s welcome.

| Name | What it can be | What it says |
| --- | --- | --- |
| `choice` | One of `local`, `pair` | Running the bots on this computer, or pairing with another one. |

### screen opened

The first time a screen is opened each time the app runs.

| Name | What it can be | What it says |
| --- | --- | --- |
| `screen` | One of `welcome`, `chat`, `automations`, `browser`, `settings/general`, `settings/appearance`, `settings/chat`, `settings/providers`, `settings/bots`, `settings/superpowers`, `settings/prompt`, `settings/browser`, `settings/environments`, `settings/advanced`, `settings/privacy`, `settings/about`, `home`, `pair`, `scan`, `telemetry`, `picture`, `call`, `chat/[id]`, `browser/[botId]`, `model/[botId]`, `automations/[id]`, `automations/prompt`, `settings`, `settings/server`, `settings/new-bots`, `settings/bot/[botId]`, `settings/look/[botId]`, `settings/voice/[botId]`, `superpowers/[botId]`, `superpowers/[botId]/[id]`, `superpowers/[botId]/[id]/file`, `superpowers/[botId]/[id]/files`, `superpowers/[botId]/[id]/problem`, `superpowers/[botId]/[id]/sign-in`, `workspace/[botId]`, `workspace/[botId]/change`, `workspace/[botId]/changes`, `workspace/[botId]/file`, `workspace/[botId]/folder`, `other` | Which screen, by its name in the code. Never which bot or conversation it shows. |

### dictation started

When the microphone is pressed to dictate a message. What is said stays on the device. It carries nothing of its own.

### app error

When something goes wrong in an app, at most ten times each time the app runs.

| Name | What it can be | What it says |
| --- | --- | --- |
| `type` | A name from OpenKumi’s own code or catalog | The kind of error, such as “TypeError”. |
| `position` | A name from OpenKumi’s own code or catalog | Where in the app’s own program it happened: the file, line and column, such as “index-B7xk.js:12:3401”. Not the error’s message. |
