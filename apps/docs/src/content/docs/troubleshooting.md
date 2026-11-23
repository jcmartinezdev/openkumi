---
title: When something is wrong
description: "Common problems with OpenKumi and what to do about each: providers, connecting, pairing, the browser, calls, automations and webhooks."
---

If your problem is not here, look at the log (below), and then
[tell us on GitHub](https://github.com/jcmartinezdev/openkumi/issues). Leave out keys, codes and
anything private.

## Where the logs are

- **The desktop app's server:** `server.log` in the app's data folder (on a Mac,
  `~/Library/Application Support/OpenKumi`).
- **A server installed alone:** `openkumi logs`, or `server.log` in its data folder
  (`~/.openkumi/people/<name>/`). A server started
  with `openkumi start` prints in its own terminal.
- **Everything an engine says:** turn on **Settings → Advanced → Log what the engines print**, try
  again, and look in the log above.

## Bots will not run

| What you see | What to do |
| --- | --- |
| A provider says **Not installed** | Install the program on the computer that runs the bots (not necessarily the one in front of you), then **Check again** under **Settings → Providers**. |
| **Installed, not signed in** | Run its sign-in in a terminal on that computer: `codex login`, `claude`, or `grok login`. |
| **Not found** | A program path was set under **Settings → Providers** and nothing is there. Correct it, or clear it. |
| **…is a launcher script OpenKumi cannot follow** (Windows) | Give the path of the program the script starts, under **Program path**. |
| **No local model server is running** | Start Ollama or LM Studio, or enter its address under **Local models**. |
| A bot on a local model ignores its tools, or loops | Use a model that can call tools, and a larger one if you can; small models are often poor at it. |
| **Stopped after 80 steps without finishing** | A bot on a local model or an API reached **Settings → Advanced → Steps per turn**. Raise it, or split the job. |
| You are told the bot is busy when you send a message | Ten messages are already waiting for it. Wait, take one back, or **Send now** one of them. |

## The app cannot connect

| What you see | What to do |
| --- | --- |
| **Port 4317 is already in use** | Something else uses OpenKumi's port. Stop it, or set `OPENKUMI_PORT` to another port. |
| **OpenKumi … is already running on this computer, and is too old for this app** | A server you installed alone is older than the app. Run `openkumi update` there, or stop it and the app runs its own. |
| **…newer than this app can work with** | Update the app: **Settings → About**. |
| The app says a server is older or newer than it | Update the one it names. For a server that is behind, **Update it** beside the environment asks it to update itself. |
| **…answers at …, but no longer lets this device in. Pair them again.** | This device was removed on the computer that runs the bots, or that server's data was reset. Pair again. |
| **The OpenKumi at … does not know this device, so it may be a different one. Its key was not sent there.** | Something else answers at that address, such as another OpenKumi server or a device that got the same home address. Check the address. |
| A remote environment never connects away from home | Turn Tailscale on, on both. Or add an `https` address of your own under its addresses. See [Servers and addresses](/connections/). |
| A remote environment never connects at home | **Let other computers connect** must be on, on the computer that runs the bots (`openkumi lan on`). Check that both are on the same network, and that a firewall lets port 4317 in. |

## Pairing fails

- **The pairing code was not right, or it has run out.** A code works once, for ten minutes, and
  five wrong tries use it up. Asking for a new code replaces the old one. Make a new one on the
  computer that runs the bots and type it again (any case, with or without the dashes).
- **There is no pairing code to use right now.** No code is waiting. Choose **Pair a computer**
  (or `openkumi pair`) first.
- **Computers are paired and removed on the computer running OpenKumi.** Pairing and removing
  devices are only done there, not from a paired device.

## The browser

- **Google Chrome was not found.** Install Chrome on the computer that runs the bots, or choose
  another program under **Settings → Browser → Browser program**.
- **Take control of the browser first.** You pressed something in a bot's browser without taking
  control. Press **Take control**.
- **Only web addresses can be opened in a bot's browser.** A bot's browser opens `http` and
  `https` addresses only, not files.
- A site keeps asking the bot to sign in again: sign it in once yourself with **Take control**; the
  bot's profile keeps the sign-in from then on.

## Superpowers

- **Sign in again** on a superpower: the bot's sign-in lapsed or was revoked in the app. Sign it in
  again from the superpower's page.
- A sign-in **with your browser** never comes back: the desktop app has to be installed (not run
  from the source) for your computer to open `openkumi://` with it. Use **Inside the bot's
  browser** instead.

## Calls

The phone button says what is missing. Calls need Codex installed on the computer that runs the
bots, signed in with a ChatGPT plan (not an API key), and switched on under **Settings →
Providers**. If calls stopped working after Codex was updated, update OpenKumi: the way Codex
reaches the voice is one OpenAI marks experimental.

## Automations and webhooks

- **A run at a time of day was missed.** The computer was asleep or off for more than ten minutes
  past it. It runs at the next time.
- **A watch was paused.** Its looks failed for a day, or it cannot work as it is set up (the tool is
  gone, the bot's sign-in lapsed, the page answers "not found"). The bot said why in its
  conversation. Put it right, then turn the automation on again; it looks at once.
- **A webhook never starts anything.** Check, in order: the computer is awake; the tunnel points
  at the webhook port (4318), not 4317; the **Public address** under the superpower is the tunnel's
  `https` address; the signing secret was copied from the app; the automation is turned on.

## Starting over

- **Delete all conversations:** **Settings → Advanced**. Bots, their files and their settings stay.
- **Delete one bot:** its page, **Danger zone**. Its conversations, files, memory and saved logins
  go with it.
- **Start completely fresh:** quit OpenKumi and move `~/.openkumi` somewhere else. The next start
  makes a new one with **Kumi** in it. Paired devices will have to pair again.
