---
title: "Engines and models: Claude Code, Codex, Grok and local models"
description: "What bots run on: the Claude Code, Codex and Grok programs, local models and OpenAI-compatible APIs."
---

Bots run on an engine by default. An engine is a program that keeps the conversation and runs the
model-and-tools loop itself. (OpenKumi also has a loop of its own, which asks a model for one step
at a time; it is what bots on local models or an OpenAI-compatible API run on.) OpenKumi starts
the `claude`, `codex` or `grok` program installed on the computer for each turn, gives it the bot's instructions and
what was said since it last ran, and serves the bot's tools to it over MCP at an address that
exists only for that turn. Tool calls are carried out and recorded the same way on either path.
Codex runs as its app server (`codex app-server`), the program its own apps talk to, which sends a
reply as it is written and takes one more message into a turn that is running. Claude Code's input
is left open while it works, for the same purpose.

The engines are started with their own tools for running commands and touching files switched
off, and without your personal setup in them (settings, instruction files, skills, plugins, MCP
servers), with one exception noted below for Grok. A bot on an engine can therefore do exactly what it can do on OpenKumi's
own loop. What changes is whose model and account it runs on.

- You sign in to each program yourself (`claude`, `codex login`, `grok login`); OpenKumi never sees the
  credentials. Usage counts against that account.
- Each program keeps its own record of the conversations it ran (under `~/.claude` and
  `~/.codex`).
- Codex's app server reads your own Codex config file, where the other programs can be told to
  leave it out. The MCP servers you set up there are switched off by name for a bot's turn, and so
  is what you have Codex run when a turn ends; your default model there is the one a bot on
  "Default" runs on.
- Grok takes an MCP server only from a settings file in a folder it has been told to trust. OpenKumi
  keeps a folder for that inside each bot (`private/grok/`), so Grok's own list of trusted
  folders (`~/.grok/trusted_folders.toml`) gains an entry per bot. Grok's skill list is not
  switched off; with its tools off, a skill there has nothing to act with.

## Local models


Start Ollama or LM Studio on the computer that runs the bots and it shows up under **Settings →
Providers → Local models**, with the models it has; a bot's settings then offer them. For another
program or port, enter its address there. Bots need a model that can call tools, and small models
are often poor at it: expect a bot on one to be less capable than on the engines above.
