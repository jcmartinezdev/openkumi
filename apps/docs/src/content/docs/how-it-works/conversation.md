---
title: One conversation per bot
description: "How a bot's single conversation works, and what happens when it grows long."
---

A bot has a single conversation with you. It begins with the first message and goes on from
there; subagents work in threads of their own beneath it and report back into it. **Start fresh**,
in the conversation's header, sets the conversation so far aside and begins an empty one. What the
bot knows is untouched, because that lives in its folder and not in the conversation. Earlier
conversations are kept: the clock button beside it lists them and searches everything that was
said, and any of them can be continued in place of the current one.

A conversation that never ends cannot be sent to a model whole for ever:

- On an engine, the program keeps the conversation and shortens it by itself.
- On OpenKumi's own loop (local models, OpenAI-compatible APIs), once the conversation passes
  **Settings → Advanced → Length of a conversation**, the model is asked to summarise the older
  part, and from then on it is sent that summary and what came after it. A model that refuses a
  conversation as too long before the limit is reached gets the same treatment at once, and is
  asked again.
- A bot that is moved to another engine is told what was said most recently, with the summary if
  there is one.

None of this deletes anything. You still see every message, and the bot has `search_history` and
`read_history` to look up what is no longer in front of it.
