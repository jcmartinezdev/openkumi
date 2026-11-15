---
title: Where everything lives
description: "The folder an environment keeps its bots, conversations and settings in, and what belongs to you and what to the bot."
---

An environment keeps everything in `~/.openkumi` (override with `OPENKUMI_HOME`). OpenKumi was
called Open Bot until November 2026: the first time it starts, it moves `~/.openbot` (and the app's
own folder, `Open Bot` in the system's application data) to the new name, unless a server or app of
the old name still has it open. The app's settings
screens only read and write these files, so you can also edit them by hand.

```
~/.openkumi/
  bots/<id>/
    bot.md                   yours: name, what it is for, model and the rules the bot must follow
    superpowers.json         yours: the superpowers switched on for this bot
    workspace/               the bot's own, and the only place its file tools reach
      AGENTS.md              its instructions, which it writes and updates itself
      memory/                its notes; only the list is loaded, it reads a note when needed
      files/                 working files and browser downloads (not in the history)
    private/                 never visible to the bot
      browser-profile/       its Chrome profile: cookies, logins
      superpowers/<id>.json  its account with the app a superpower works in
      history.git/           the record of every change to the workspace
  openkumi.db                conversations, messages and automations
  settings.json              app-wide settings that differ from the defaults
  auth.json                  API keys and the access code (owner-readable only)
  clients.json               the computers paired with this one (owner-readable only)
  runtime/                   only for a server installed on its own: the program, not your data
    versions/<version>/      that version's server, with the Node it runs on
    current                  a link to the version that is started
```

The split is deliberate. **What a bot can do is yours:** its model, rules and superpowers
sit outside its workspace, so it cannot grant itself anything. **What a bot knows is its own:** it
rewrites `AGENTS.md` and `memory/` freely. Each change is a commit in a git history kept in
`private/history.git`, labelled with who made it (the bot or you), and the Files tab can show and
undo it. (`git --git-dir=…/private/history.git --work-tree=…/workspace log` reads it by hand.)
