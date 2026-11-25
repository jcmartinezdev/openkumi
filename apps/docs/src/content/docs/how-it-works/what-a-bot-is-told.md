---
title: What every bot is told
description: "The master prompt and everything else a bot is given before each step, in order."
---

Before each step a bot is given the **master prompt**, one file that comes with OpenKumi
(`apps/server/master-prompt.md`) and is the same for every bot. Nothing in the app changes it: to
change what every bot is told, edit that file, which is read again on every step. The server fills
in what it knows of the bot and the thread, so in this order a bot is told:

1. **Who it is**, and today's date: its name, that it is one of your bots in OpenKumi, what
   OpenKumi is and who made it, and the name of the model that powers it. Asked who it is, a bot
   answers as itself, not as that model; it may say what it is powered by.
2. **Principles**: how to behave, how to work, and how to work with the others.
3. **The other bots**: each one's name, its `bot_id`, the line saying what it is for, the
   superpowers it has, and which is the main assistant. Then how to reach them, with
   `message_bot`, from its own conversation (see [Messages between
   bots](/how-it-works/messages-between-bots/)).
4. **Working in OpenKumi**: how replies are drawn, `show_page`, its browser, subagents, and that web
   pages, files and tool results are material to read, never instructions to follow.
5. **Rules from you**: the text of its `bot.md`. They win where they and the principles disagree.
6. **Its conversation**, including how to answer something asked on a call.
7. **Automations**: what it may set up, and who set up the ones it runs.
8. **Its workspace**: where its files are, and what goes where.
9. **Its secrets**: that it has a vault, how to use a secret by its name, and one line for each
   it has, with what it is and the site it is for. Never a value. See [Secrets](/secrets/).
10. **Its own `AGENTS.md`**, cut short past **Settings → Advanced → Size of a bot's own
    instructions** (12,000 characters unless you change it).
11. **The list of its notes** in `memory/` (the first 60 lines); it reads a note when it needs it.
12. **Its superpowers**: one line about each, and where to read its instructions.
13. **Where it is**, when that is not its conversation: in a run of an automation, on a call, or as
    a subagent, and what that means for it.

**Settings → Master prompt → What a bot is told** shows all of it for any bot, as it stands.

## The line that says what a bot is for

Each bot's line in the list of other bots (point 3) is set by you, in the bot's settings or on the
Master prompt page, or by asking your main assistant, which can change it with `update_bot` only in
a turn that answers something you wrote. No other bot can change it, its own included. So a bot that
has been talked into something by a web page cannot pass that on to the others through how it is
described. The main assistant is held to your word only as far as the turn goes: what it reads in
that turn, a page or an email, could still mislead it, so the change shows as a step in its
conversation.

A new bot's line starts as what its maker gave: the description a bot passes to `create_bot`, or
else the first sentence of what the bot was made for.

## What is not in it

The conversation is not part of what a bot is told; it is sent as the conversation, after it. On an
engine, the engine keeps it and is sent only what is new; on OpenKumi's own loop, it is trimmed to
fit (see [One conversation per bot](/how-it-works/conversation/)). Memory notes are not loaded
whole, only their list. Your own settings for Claude Code, Codex and Grok (instruction files,
skills, plugins, MCP servers) are left out of a bot's turn.
