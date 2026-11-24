---
title: The openkumi command
description: "Every command of a server installed alone: starting it, the background service, status, pairing, network access, updates, logs, removing it, and the people with bots on the computer."
---

A server installed with `install.sh` ([Installing and updating](/install/#the-server-alone)) comes
with an `openkumi` command in `~/.local/bin`. It is everything you do at that computer without the
app. From a clone of the repository, the same commands run as `npm run openkumi -- <command>`.

| Command | What it does |
| --- | --- |
| `openkumi start` | runs the server here, in this terminal. Where several people have bots on this computer, it runs everyone's, each line marked with whose server printed it. Ctrl-C stops them all. |
| `openkumi service install` | keeps it running in the background, also after a restart: a launchd agent on a Mac, a systemd unit of your user on Linux |
| `openkumi service remove` | stops that, and removes the service. Your bots and data are untouched. |
| `openkumi service status` | whether the background service is set up and running |
| `openkumi status` | whether the server runs and which version, where its data is, whether other computers can reach it, what the bots can run on, whether Chrome was found, and whether an update is waiting |
| `openkumi pair` | a pairing code and this computer's home network addresses, for the app on another computer or phone (**Settings → Environments → Add environment**). The code works once, for ten minutes. |
| `openkumi lan on` / `off` | whether other computers on your network can reach it. Each still needs a code to get in. From elsewhere, Tailscale included, they come through an `https` address you put in front of it. |
| `openkumi telemetry on` / `off` | whether it tells OpenKumi's makers how it is used and what goes wrong, never what you or your bots write. Without `on` or `off`, how that stands. See [Usage and error reports](/telemetry/). |
| `openkumi update` | fetches the newest version and starts it once no bot is working. Where several people have bots on this computer, their servers start it too, each once none of its own bots is working. |
| `openkumi update --now` | the same, without waiting for the bots: those at work are stopped |
| `openkumi update --check` | only says whether there is a newer version |
| `openkumi logs` | the last of what the background service printed (`server.log` in your data folder, `~/.openkumi/people/<name>/`) |
| `openkumi uninstall` | removes OpenKumi from this computer: the program, the command and the service. Your bots and data stay in `~/.openkumi`. |
| `openkumi version` | the version installed |
| `openkumi help` | the list of commands |

`status`, `pair`, `lan` and `update` talk to the server running on this computer, with its access
code from the data folder, so the server has to be running.

## Bots for someone else

Bots belong to a person, and each person on a computer has a server of their own there, apart
from the others': see
[Bots for someone else in the house](/environments/#bots-for-someone-else-in-the-house). You are
the first, made when OpenKumi first started, and the commands above are about your server. The
desktop app does the same from the switcher at the top of the sidebar and each person's **Settings
→ Profile & devices**, on a computer where it runs the bots itself.

| Command | What it does |
| --- | --- |
| `openkumi people` | who has bots here, on which port, and whether each one's server runs |
| `openkumi people add <name>` | bots of their own for someone else: a data folder in `~/.openkumi/people/<name>/`, a port of its own, and a background service of its own. Other computers on your network can reach it from the start, and it prints the address and a pairing code for their app. |
| `openkumi people remove <name>` | stops their server and removes its service. What it held stays in its folder, and adding the same name again carries on with it. The first person is not removed: they are the one a command with no name is about, and can be given another name. |
| `openkumi people rename <name> <new name>` | another name for someone, yourself included. Their folder and service are renamed with them, and what is paired with their server stays paired. |
| `--for <name>` | after any command of the first table, makes it about that person's server: `openkumi pair --for ana`, `openkumi status --for ana`, `openkumi lan off --for ana`, `openkumi logs --for ana`. |

`openkumi uninstall` removes the program for everyone on the computer, and stops all their
servers.

## How it starts

The background service runs `~/.openkumi/runtime/current/bin/openkumi serve --for <name>`, with
the Node that came with the release. When an update is in place, the server stops and asks to be started again;
`current` then points at the new version. Versions are kept in
`~/.openkumi/runtime/versions/<version>/`, each with the Node it runs on.

Each person's server is that same program under a service of its own
(`ai.openkumi.server.<name>` on a Mac, `openkumi-<name>.service` on Linux). Each running server
leaves a note of its version in `~/.openkumi/runtime/running/`, so an update one of them fetched
does not remove the version another is still running, and each looks every 15 seconds for a
version another one put in place, to start it too.

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

`OPENKUMI_PORT` and `OPENKUMI_HOOKS_PORT` are about the first person's server. Everyone else's
takes its port from `~/.openkumi/people.json`, and its webhooks on the port after it.
