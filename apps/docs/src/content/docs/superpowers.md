---
title: Superpowers
description: "What a bot can do beyond its own tools, how a superpower is built, and how a bot signs in to one."
---

A superpower is what a bot can do beyond its own tools. Every one ships with OpenKumi, as a folder
in `apps/server/superpowers/<id>`:

```
superpower.json   name, tagline, categories, what a bot can do with it, the line the bot is told,
                  and its service (an MCP server), when it has one
icon.svg          its app icon, on a square with only a viewBox (each app rounds the corners)
README.md         its page in the app
instructions.md   how the bot goes about it; the bot reads it when a task calls for it
```

Any other file in the folder is the bot's to read too, and the owner can read every one of them
(never change them) on the superpower's page. `apps/server/superpowers/categories.json` lists the
catalog's groups in their order; a superpower names each group it belongs to, so the same one can
be in several.

A superpower has instructions, a service, or both. The app ones (Notion, Linear and the rest) are
both: instructions, and the app's own MCP server, which the bot signs in to with an account of its
own (two bots can use two different accounts). The know-how ones (Weather, SEO & AI search and the
rest) are instructions only: free services the bot reaches with `web_fetch`, or ways to use its own
browser, files, pages and automations, with nothing to sign in to. A service can also be a
program run on this computer, which is how a superpower with code of its own would work.

You activate a superpower for one bot at a time, on its page or in the bot's settings; nothing is
activated for all bots at once. Deactivating one for a bot forgets that bot's sign-in.

One that works in an app is active only once the bot has signed in to it, so **Activate
superpower** opens a popup that asks how:

- **With your browser** (the desktop app, installed): the service's page opens in the browser on
  your computer, with the accounts you already have there. The service sends that browser back to
  `openkumi://sign-in/callback`, which the computer opens with OpenKumi, and the app passes it to
  the environment it shows, so this works whichever computer the bots run on.
- **On the phone**: the service's page opens in a sign-in sheet that has the accounts you have in
  Safari, and the sheet hands the way back to the app, which passes it on the same way.
- **Inside the bot's browser**: the page opens in a window of the bot's own browser, which you use
  from the app on any computer or the phone, as you would any window you take control of. It suits
  giving a bot an account other than yours. The service sends that browser back to an OpenKumi
  address it cannot reach; the browser reads the result from that address on the way.

Either way the bot gets an account of its own, and cancelling leaves the superpower as it was,
with nothing kept. A bot that is signed out later shows **Sign in again**. A bot is
told one line about each of its superpowers, with where to read the instructions; it can read
them but not change them, and it cannot switch a superpower on for itself.
