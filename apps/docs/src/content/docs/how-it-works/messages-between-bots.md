---
title: Messages between bots
description: "How one bot passes work to another, and the limits that keep that safe."
---

A bot reaches another with `message_bot`: the message goes into that bot's **own conversation with
you**, through its queue, and the bot answers it there as itself, with its own instructions, files,
logins and superpowers. So the work is where you would look for it, the bot remembers it, and you
can carry on with it. Both conversations show the message ("To Travel", "From Assistant"), and
either one opens the other end.

- A message from a bot is **a teammate's request, not your word**: the bot that gets it is told so,
  and does not buy, send or delete anything on the strength of it.
- **A bot writes back only when it was asked to.** The sender says whether it wants a reply. A bot
  that is answering another bot's message can message only that bot, and only if a reply was asked
  for; anything else is refused. When it answers you, it may message any bot.
- **Twenty messages** leading from one to the next, without you saying anything in between, is
  where a chain ends.
- Only a bot's own conversation can send one: not a subagent, and not a run of an automation (whose
  result reaches the conversation, which can).
- **Settings → Bots → Bots can message each other** switches it all off.
