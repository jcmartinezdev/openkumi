---
title: "The queue: one message at a time"
description: "How messages to a busy bot wait, and how Send now changes its course."
---

Everything said to a bot waits in a queue on the server before it becomes part of the
conversation: what you write, what another bot writes, and what the bot's own subagents and
automations report back. The server lets in one message at a time, and the bot answers it in a
turn of its own before the next goes in. A bot that is idle takes a message up at once.

- **Waiting messages are in view**, at the foot of the conversation, on the computer and the
  phone. The **×** takes one back before the bot has read it: yours, or one from another bot.
- **Send now** has the bot read a waiting message as it works, ahead of the others, so that you can
  change its course without stopping it. A model OpenKumi asks itself (a local model, an API) gets
  it before its next step. Codex and Claude Code take it into the turn that is running: Codex as
  soon as it is sent (`turn/steer`), Claude Code after the tool call under way (a message marked
  to be read next), or once it has finished writing when no tool is in use. Grok cannot be told as
  it works, so its turn is cut short once the tool call under way has been answered, and it reads
  the message next, in the same conversation of its own; so does Codex in the moments it will not
  take one. Nothing a tool is doing is cut off half way; `wait_subagents`, which only waits, gives
  way at once.
- **At most ten messages wait** for a bot. One more is refused: you are told the bot is busy and
  keep what you wrote; a bot is told to try later or tell you. What the bot's own work reports, and
  a reply it asked another bot for, always get in.
- **Stop means stop.** A bot that is stopped, or fails, does not start again by itself on what was
  waiting: those messages are held back until you write to it, press **Resume**, or send one of
  them now. What its own subagents and automations had to report is put in the conversation as
  it is, for the bot to see when it goes on.
- The queue is kept in the database, so what waits when the server stops is read after it starts
  again, unless it was held back.
