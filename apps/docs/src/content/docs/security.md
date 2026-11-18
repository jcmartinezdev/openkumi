---
title: Security notes
description: "What OpenKumi trusts, what it does not, and why."
---

- Every request to the server has to carry a key. Nothing is trusted for where it comes from and
  there are no cookies, so a web page open in a browser has no way in, and only the app's own pages
  may read the server's answers. On the computer the server runs on, the key is its access code
  (in `auth.json`), which the app there reads from the data folder and which is refused from
  anywhere else. Every other computer is paired (see [Pairing with another computer](/environments/#pairing-with-another-computer)) and holds a key of its own, kept by
  the server only as a hash in `clients.json`.
- By default the server listens on `127.0.0.1` only; with network access on it listens on the
  local network too. Traffic there is plain HTTP: pairing does not give its code away to someone
  listening, but a paired computer's key travels with each request, so someone who can watch the
  network could copy it. Use it only on networks you trust, and remove a computer you no longer
  use. There are no user accounts: anyone with access to your OS user account can use it.
- The app's window only ever loads the app's own page, and that page runs scripts only from the
  app's own files. Links, and the sign-in pages of a superpower's app, open in your browser. Pages that
  bots show run in frames that are sites of their own and cannot reach the app (see [Replies and
  pages](/how-it-works/replies-and-pages/)).
- A bot's browser holds real logins. Web pages can contain text written to manipulate an AI
  ("prompt injection"). Bots are instructed to treat page content as data and to confirm before
  purchases, sending messages or deleting things, but that is a mitigation, not a guarantee. Give a
  bot only the logins you are comfortable with it using.
- A bot that edits its own instructions can be talked into a bad edit by something it reads. Two
  things limit that: the rules in `bot.md` are outside its reach, and every change to `AGENTS.md`
  and `memory/` is in the history where you can undo it.
- A bot that was talked into something could ask another bot for it. So a message from a bot is
  never taken as your word: the bot that gets it is told to ask you before a purchase, sending or
  deleting. A bot answering a bot can write back only when it was asked to, a chain of such
  messages ends at twenty, only the main assistant creates bots and only when you asked, and
  **Settings → Bots** switches messages between bots off. A bot can send another copies of its own
  files with a message, which land in the other bot's `files/inbox/`; no bot can open another's
  folder or fetch a file from it, and a file that arrived this way is, like any file a bot did
  not write itself, read as material, not as instructions.
- What you type into a bot's page goes to it only from the device that took control of its window,
  so a view that is only watching cannot press anything by accident.
- A bot's browser and `web_fetch` cannot open files on the computer or OpenKumi's own address.
  Without that, a bot could read your keys, or open the app as you and change its own rules.
- Superpowers come only with OpenKumi; there is no way to add one from the app. A superpower's
  instructions are followed with the bot's browser and accounts, so each is written to ask before
  anything is sent, changed or paid.
- A superpower's sign-in finishes only the way it was started, once, for the bot it was started
  for: the way back from your own browser is checked against the sign-in the app began, and in the
  bot's browser only the window it was started in counts. OpenKumi's own address cannot finish one
  over the network or from a bot's own windows. Signing in inside the bot's browser also leaves that
  browser signed in to the service's website; signing in with your own browser does not.
