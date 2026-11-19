---
title: Settings and configuration
description: "What each settings page holds, and the environment variables the server reads."
---

## Settings

Everything is set from the Settings page, which saves each change as you make it:

| Page | What it holds |
| --- | --- |
| General | what a new bot starts with; sidebar and confirmation preferences |
| Appearance, Chat | theme, text size, how Enter behaves, how much detail a step shows (kept per device) |
| Providers | Codex and Claude Code (status, program path), other models; switch any of them off |
| Bots | every bot: what it is for, its rules, model, superpowers and files; whether bots may message each other |
| Superpowers | what bots can do beyond their own tools: what each does, and which bots have it |
| Master prompt | what each bot is for; everything a bot is told, to read |
| Browser | which browser program the bots drive, and which bots have one running |
| Environments | the local environment (on or off) and remote ones; letting other computers connect to the one being shown, its link and access code |
| Advanced | limits (steps per turn, subagents), troubleshooting, the data folder |
| Privacy | whether the computer that runs your bots tells OpenKumi's makers how it is used and what goes wrong, and everything it sent (see [Usage and error reports](/telemetry/)) |
| About | the version of the app and of the environment it shows, and their updates |

App-wide settings are stored in `~/.openkumi/settings.json` (only values that differ from the
defaults). Preferences marked "this device" stay in the app on that computer.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENKUMI_PORT` | `4317` | the server's port |
| `OPENKUMI_LAN` | unset | `1` lets other computers on the network connect whatever Settings says (same as `--lan`) |
| `OPENKUMI_HOME` | `~/.openkumi` | data directory |
| `OPENKUMI_BROWSER_CHANNEL` | from Settings | Playwright browser channel (`chrome`, `msedge`, …); overrides Settings |
| `OPENKUMI_MOCK` | unset | set to `1` to enable the scripted offline provider used by tests |
| `OPENKUMI_CLAUDE_BIN`, `OPENKUMI_CODEX_BIN`, `OPENKUMI_GROK_BIN` | from Settings, else found on `PATH` | where the `claude`, `codex` and `grok` programs are; overrides Settings |
| `OPENKUMI_DEBUG` | from Settings | set to `1` to log everything an engine prints |
| `OPENKUMI_RELEASES_URL` | this project's releases on GitHub | where a server installed on its own, and its installer, look for versions |
| `OPENKUMI_DESKTOP_UPDATES_URL` | this project's releases on GitHub | another place for the desktop app to look for versions of itself |
| `OPENKUMI_TELEMETRY` | from Settings | `0` stops the server telling OpenKumi's makers anything, whatever Settings says (see [Usage and error reports](/telemetry/)); `DO_NOT_TRACK=1` does the same |
| `OPENKUMI_TELEMETRY_URL`, `OPENKUMI_TELEMETRY_KEY` | PostHog in the EU, OpenKumi's project | another place and project for those reports to go, for testing; with these set a server run from the source sends too |
