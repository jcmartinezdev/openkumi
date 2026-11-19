---
title: The openkumi command
description: "Every command of a server installed alone: starting it, the background service, status, pairing, network access, updates, logs and removing it."
---

A server installed with `install.sh` ([Installing and updating](/install/#the-server-alone)) comes
with an `openkumi` command in `~/.local/bin`. It is everything you do at that computer without the
app. From a clone of the repository, the same commands run as `npm run openkumi -- <command>`.

| Command | What it does |
| --- | --- |
| `openkumi start` | runs the server here, in this terminal. Ctrl-C stops it. |
| `openkumi service install` | keeps it running in the background, also after a restart: a launchd agent on a Mac, a systemd unit of your user on Linux |
| `openkumi service remove` | stops that, and removes the service. Your bots and data are untouched. |
| `openkumi service status` | whether the background service is set up and running |
| `openkumi status` | whether the server runs and which version, where its data is, whether other computers can reach it, what the bots can run on, whether Chrome was found, and whether an update is waiting |
| `openkumi pair` | a pairing code and this computer's addresses, for the app on another computer or phone (**Settings → Environments → Add environment**). The code works once, for ten minutes. |
| `openkumi lan on` / `off` | whether other computers on your network (and Tailscale) can reach it. Each still needs a code to get in. |
| `openkumi update` | fetches the newest version and starts it once no bot is working |
| `openkumi update --now` | the same, without waiting for the bots: those at work are stopped |
| `openkumi update --check` | only says whether there is a newer version |
| `openkumi logs` | the last of what the background service printed (`~/.openkumi/server.log`) |
| `openkumi uninstall` | removes OpenKumi from this computer: the program, the command and the service. Your bots and data stay in `~/.openkumi`. |
| `openkumi version` | the version installed |
| `openkumi help` | the list of commands |

`status`, `pair`, `lan` and `update` talk to the server running on this computer, with its access
code from the data folder, so the server has to be running.

## How it starts

The background service runs `~/.openkumi/runtime/current/bin/openkumi serve`, with the Node that
came with the release. When an update is in place, the server stops and asks to be started again;
`current` then points at the new version. Versions are kept in
`~/.openkumi/runtime/versions/<version>/`, each with the Node it runs on.

The service runs as you, not as the system, because the bots use your sign-ins to Claude Code,
Codex and Grok. On Linux it asks to keep running after you log out; where the
system does not allow that, `openkumi service install` says how an administrator can.

## Environment variables

`OPENKUMI_PORT`, `OPENKUMI_HOME` and the rest work here as they do anywhere: see [Settings and
configuration](/settings/#environment-variables). `openkumi service install` writes
`OPENKUMI_HOME`, `OPENKUMI_PORT`, `OPENKUMI_HOOKS_PORT` and `OPENKUMI_RELEASES_URL` into the
service as they are set when you run it, with your `PATH` (and the usual places programs are
installed), so the service finds Claude Code, Codex and Grok as your terminal does. Run it again
after changing one of them.
