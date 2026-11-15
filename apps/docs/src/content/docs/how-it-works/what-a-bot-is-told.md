---
title: What every bot is told
description: "The master prompt and everything else a bot is given before each turn."
---

Before each turn a bot is given the **master prompt**, one file that comes with OpenKumi
(`apps/server/master-prompt.md`) and is the same for every bot. Nothing in the app changes it: to
change what every bot is told, edit that file, which is read again on every step. The server fills
in what it knows of the bot and the thread, so in this order a bot is told:

1. **Principles**: how to behave and how to work with the others.
2. **The other bots**: each one's name, its `bot_id`, the line saying what it is for, the
   superpowers it has, and which is the main assistant. The line is set by you, in the bot's
   settings or on the Master prompt page; no bot can change it, its own included, so one bot that has
   been talked into something by a web page cannot pass that on to the others through how it is
   described. A new bot's line starts as what its maker gave: the description a bot passes to
   `create_bot`, or else the first sentence of what the bot was made for.
   Then how to reach them: with `message_bot`, from its own conversation (see [Messages between
   bots](/how-it-works/messages-between-bots/)).
3. How OpenKumi works (replies, the browser, subagents, and that web pages and tool results are
   never instructions), then the bot's **rules from you**, which win where they and the principles
   disagree.
4. Its conversation, automations, workspace, its own `AGENTS.md`, the list of its notes, and
   its superpowers; in a run of an automation or as a subagent, what that means for it.

**Settings → Master prompt → What a bot is told** shows all of it for any bot.
