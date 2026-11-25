---
title: When something is wrong
description: "Common problems with OpenKumi and what to do about each: providers, connecting, pairing, people on one computer, the browser, calls, automations and webhooks."
---

If your problem is not here, look at the log (below), and then
[tell us on GitHub](https://github.com/jcmartinezdev/openkumi/issues). Leave out keys, codes and
anything private.

## Where the logs are

- **The desktop app's server:** `server.log` in the app's data folder (on a Mac,
  `~/Library/Application Support/OpenKumi`). The servers it runs for the other people with bots on
  the computer write `server-<name>.log` beside it.
- **A server installed alone:** `openkumi logs`, or `server.log` in its data folder
  (`~/.openkumi/people/<name>/`); `openkumi logs --for <name>` for someone else's. A server started
  with `openkumi start` prints in its own terminal, each line marked with whose server it is.
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
| A remote environment never connects away from home | Away from home it needs an `https` address (on Tailscale or the internet), added under its addresses. A plain `http` Tailscale address is refused. See [Away from home](/connections/#away-from-home). |
| A remote environment never connects at home | **Let other devices connect** must be on, on the computer that runs the bots (`openkumi lan on`). Check that both are on the same network, and that a firewall lets port 4317 in (and the port of each other person's server there, 4327 and on). |

## Updates

- **Settings → About shows another computer's OpenKumi without Update**, and says it is updated
  with the app. Either the app on that computer is older than 0.0.7: update it there once, and
  from then on **Update** works from here. Or that app does not update itself, because it runs
  from the repository or, on Linux, is not the AppImage: update it there, the way it was
  installed (with `git` for the repository), each time.
- **Settings → About says another computer's OpenKumi runs from its source, and is updated there
  with git.** That is a server run from the repository on its own. Update it there with `git`;
  it cannot be updated from here.
- **The other computer's app says it restarts once some bots are done, and does not.** It waits
  until none of the bots on that computer, everyone's, has worked for a moment. **Start it now**
  does not wait; what they have done so far is kept.

## Pairing fails

- **The pairing code was not right, or it has run out.** A code works once, for ten minutes, and
  five wrong tries use it up. Asking for a new code replaces the old one. Make a new one on the
  computer that runs the bots and type it again (any case, with or without the dashes).
- **There is no pairing code to use right now.** No code is waiting. Choose **Pair a device**
  (or `openkumi pair`) first.
- **Computers are paired and removed on the computer running OpenKumi.** Pairing and removing
  devices are only done there, not from a paired device.

## People on one computer

| What you see | What to do |
| --- | --- |
| **Nobody called "ana" has bots on this computer.** | `openkumi people` lists who does, under the names they have here. |
| **OpenKumi from before this version is still running on this computer, with its data open.** | The first start of a version with a folder per person moves your data into `~/.openkumi/people/<name>/`, and does not move it from under a server that is still running. Stop that one as the message says (it gives the command for a background service), then start again. |
| **…'s server is running, started by hand. Stop it…** | Someone's server was started in a terminal, so it cannot be stopped for removing or renaming them. Press Ctrl-C there (which stops every server started in that terminal) and run the command again. |
| **OpenKumi was started outside this app on this computer, so its people are looked after there** | The app uses a server you installed alone, or started in a terminal, and leaves people to it: `openkumi people add <name>` there. |
| **…people.json is not a list of the people with bots on this computer…** | The file in `~/.openkumi` that says who has bots, and on which port, is damaged, and nothing starts until it is put right. It is a list like `[{ "name": "sam", "port": 4317 }, { "name": "ana", "port": 4327 }]`, the first person first. |
| **The data in ~/.openkumi was written by a newer version of OpenKumi** | An OpenKumi from before people had folders was started after a newer one had moved the data into them. Nothing was changed: update the older one. |
| Someone's bots are not in the app on the computer that runs them | Pick them in the switcher at the top of the sidebar. Their own computers and phones are paired with their own server, on their **Profile & devices** page. |
| **Waiting for …'s bots on this computer…** | Their server has not started, or has stopped. The app starts everyone's with yours and looks again every few seconds; **Show …'s bots instead** goes back to yours. Their log says why it does not start (see above). With a server installed alone, `openkumi people` says whether each one runs, and `openkumi logs --for <name>` what it printed. |

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
- **T3 Code is not open on this computer.** The T3 Code superpower only works while T3 Code runs
  on the computer that runs the bot. Open it there, then ask again.

## Secrets

- **A secret says the key it was encrypted with is not on this computer.** The data folder was
  moved or restored from a backup, or the keychain was reset, and the key that opens the vault did
  not come with it. Choose **Enter it again** beside it, in the bot's **Secrets**; nothing else is
  lost.
- **The Mac's keychain did not give the vault's key.** The keychain is locked: the Mac was
  started and nobody has logged in yet, or OpenKumi runs in a session reached over ssh. Log in to
  the Mac once; the bot can then use its secrets. On Linux the same holds for the desktop's
  keyring.
- **A bot asks for a key it already has.** The key it has stopped working (it was changed or
  revoked at the site). What you type in its card takes the place of the old one.

## Notifications

- **No notification comes**, though a bot shows **Needs you** or **Read this**. Notifications
  are shown only while OpenKumi is not in front, and not for a blue dot. Check **Settings →
  General → Notify me when a bot needs me** on that computer, and that the system lets OpenKumi
  show notifications (on a Mac, **System Settings → Notifications**). The iPhone app has no
  notifications yet.
- **The window is gone but the bots keep working.** On a Mac, closing the window leaves OpenKumi
  running, so that bots can still reach you. Click its icon in the Dock to bring the window back;
  quit it to stop the bots.

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
  at the webhook port (4318, or the port after another person's server), not the server's own;
  the **Public address** under the superpower is the tunnel's
  `https` address; the signing secret was copied from the app; the automation is turned on.

## Starting over

- **Delete all conversations:** **Settings → Advanced**. Bots, their files and their settings stay.
- **Delete one bot:** its page, **Danger zone**. Its conversations, files, memory and saved logins
  go with it.
- **Start completely fresh:** quit OpenKumi (for a server installed alone, `openkumi service
  remove`) and move your own folder, `~/.openkumi/people/<name>/`, somewhere else. The next start
  (`openkumi service install`) makes a new one under the same name, with **Kumi** in it, and leaves
  everyone else's as it was. Paired devices will have to pair again. Moving all of `~/.openkumi`
  would take everyone's bots with it, and the program of a server installed alone.
