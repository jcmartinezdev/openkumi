---
title: Usage
description: "How many tokens your bots' models used, by provider, model and bot; what they would have cost as API calls; and how much of your Claude and ChatGPT plans is used up."
---

**Usage** shows what your bots' models used: in the desktop app from the sidebar, on the iPhone
under **Settings → Usage**. Both show the same numbers, which the computer that runs your bots
counts and keeps.

Pick the time to look at: the last **24 hours** (by the hour), or the last **7**, **30** or **90
days** (by the day, on the calendar of the computer that runs the bots).

## What you see

- **Tokens.** How many the models were sent and how many they wrote, and how much of what was
  sent was read from a cache. A model is sent the whole conversation again each time it is asked,
  so what is sent is always far more than what is written.
- **Cost as API calls.** What the same tokens would have cost if each request had been paid for
  at the provider's list price. It is a way to compare, and to see what a plan is worth to you; it
  is **not what you are charged**. A Claude, ChatGPT or Grok plan costs what it costs however much
  of it you use.
- **Plan limits.** How much of each plan's allowance is used, and when it starts over, as Claude
  Code and Codex report it: the 5-hour session, the week, and the week for a model with an
  allowance of its own. Which of these a plan has differs. A bar turns amber from 80% and red from
  95%.
- **By the day** (or hour). A chart of tokens or cost, stacked by provider. Point at a column on
  the computer, or touch one on the phone, to read it; **Show as a table** (on the phone, **Show
  each day**) gives the same numbers as a list.
- **Providers, Models, Bots.** The same total split three ways, the most first.

## Where the numbers come from

Each time a model answers, whatever ran it says how many tokens that took, and OpenKumi adds them
to the hour's count for that bot, provider and model. So the page shows what **your bots** used
on this OpenKumi, not what else you did with the same plan in Claude Code, Codex or their apps.
The plan limits are the exception: those are the plan's own, and count everything.

| Provider | Tokens | Cost | Plan limits |
| --- | --- | --- | --- |
| **Claude Code** | as Claude Code reports each turn | as Claude Code itself prices each turn, at list prices | yes |
| **Codex** | as Codex reports each turn | from the price list | yes, when signed in with ChatGPT |
| **Grok** | when Grok reports them | as Grok prices the turn when it does, else from the price list | not reported |
| **An API** you set up | as the API reports each request | from the price list, when it has the model | none: paid by the token |
| **A local model** | as Ollama or LM Studio reports each request | none: it runs on your computer | none |

**The price list** is the public list of model prices that
[LiteLLM](https://github.com/BerriAI/litellm) keeps on GitHub. OpenKumi fetches it when you open
Usage and keeps it in your data folder: once it has the list, at most once a day, and when a fetch
failed, again no sooner than ten minutes later. Nothing about you or your bots is sent for it. A model the list does not have shows a dash where its cost would be, and the total
says how many tokens have no price. Prices are the plain list price: no discount for batches, and
none of the surcharges some models have for very long requests.

Counting began with the version of OpenKumi that brought this page: what was used before is not
known, and the page says since when it has counted. Nothing is ever deleted from the count, and it
stays when a bot is deleted.

Not counted: what a [call](/calls/) uses, and the one question that picks a new bot's look.
