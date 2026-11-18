---
title: Installing and updating
description: "How to install the OpenKumi desktop app or the server on its own, and how both keep themselves up to date."
---

OpenKumi needs Google Chrome, plus something for the bots to run on: the Codex CLI
(`codex login`), Claude Code (`claude`) or Grok Build (`grok login`), signed in; or Ollama or LM
Studio running; or an OpenAI-compatible API. With git
installed, each bot's changes to its own files are kept as a history you can undo.

**The desktop app.** Download it from [openkumi.ai](https://openkumi.ai), or pick an installer
from the [newest release](https://github.com/jcmartinezdev/openkumi/releases/latest): a `.dmg` for
a Mac with Apple silicon, an installer for Windows, an AppImage for Linux. It carries its
own server, so nothing else has to be installed. The first time, the app asks where your bots
should run. Check under **Settings → Providers** that something shows as connected, then start
chatting.

Every release is installed, opened and tried on Windows and Linux automatically before it is
published, but nobody has used OpenKumi there day to day yet. If something is off,
[tell us](https://github.com/jcmartinezdev/openkumi/issues).

**The server alone**, on a Mac or a Linux computer that runs your bots with no app in front of it
(a Mac mini in a cupboard, a machine in a rack):

```sh
curl -fsSL https://openkumi.ai/install.sh | sh
```

That downloads the newest release for that kind of computer, checks it against the checksums
published with it, and unpacks it under `~/.openkumi/runtime`. It comes with the Node it runs on,
so the computer needs neither Node nor npm. It puts an `openkumi` command in `~/.local/bin` and
keeps the server running in the background, also after a restart (a launchd agent on a Mac, a
systemd unit of your user on Linux; `--no-service` leaves that out). It runs as you, not as the
system, because the bots use your sign-ins to Claude Code, Codex and Chrome. Then:

```sh
openkumi status              # whether it runs, which version, what the bots can run on
openkumi lan on              # let your other computers and your phone reach it
openkumi pair                # a code to enter in the app on another computer or phone
openkumi update              # fetch the newest version now (it also does this by itself)
openkumi logs                # what the background service printed
openkumi service remove      # stop running in the background
openkumi uninstall           # remove OpenKumi; your bots and their data stay in ~/.openkumi
```

**From the source**, with Node.js 22.18+:

```sh
npm install
npm start          # builds the app and opens it
npm run dist       # builds an installer into release/ (a .dmg on macOS)
```

## Updates

Both parts keep themselves up to date from the project's releases, and neither needs the other to
be the same version.

- **The desktop app** looks for a newer version when it starts and every few hours, downloads it
  in the background, and shows **Restart to update** in the sidebar and under **Settings → About**
  when it is ready. It never restarts by itself: quitting stops the bots that run on this computer,
  so when any are working it asks first. Left alone, the new version takes over the next time you
  quit. The server inside the app is part of it and comes with it.
- **A server installed on its own** looks every few hours. It downloads the new version, checks
  it against the release's checksums, tries it once, and then starts it as soon as no bot is
  working. **Settings → About** in an app connected to it shows where it stands, has **Update** to
  do it now, and a switch to stop it updating by itself (it then only updates when you ask, there
  or with `openkumi update`).
- **What has to match** is not the version but one number that says how apps and servers talk
  (`packages/shared/src/protocol.ts`), raised only when a change would break one for the other.
  When they differ, the app says which of the two has to be updated instead of half working: for a
  server that is behind, **Update it** beside the environment asks that server to update itself.
  The key this computer was given still only goes to an address that has shown it is that server.
