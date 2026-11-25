---
title: Known limits
description: "What OpenKumi does not protect against, said plainly, and what to do about each."
---

OpenKumi is an alpha. These are the gaps we know of, so you can decide what to trust it with.

## Bots can be misled

A bot reads web pages, mail, documents and other bots' messages, and some of those can be written
to manipulate it. Bots are told what they read is never an instruction, and to ask before buying,
sending or deleting, but a model can still be talked into something within what its tools and
sign-ins allow.

**What to do:** give each bot only the sign-ins and superpowers its work needs, keep what must hold
in its rules, and read its **Workspace → Changes** now and then.

## A bot's browser can reach your home network

A bot's browser and `web_fetch` refuse files on this computer, and OpenKumi's own server and the
other people's servers on it at the names the computer goes by for itself (`localhost` and names
ending in `.localhost`, `127.0.0.1`, `::1`).
Otherwise they reach what any program on the computer can: the web, and also other devices on your
home network and on Tailscale, such as a router's admin page. (Watches are stricter, and refuse all
of those.) A bot holds no key, so it still cannot use another OpenKumi server it finds there.

**What to do:** keep devices on your network behind their own passwords, as you would anyway.

## No operating-system sandbox

The engines are not run inside an operating-system sandbox. What keeps a bot in is that their own
tools for commands and files are switched off, that Codex and Grok run with a read-only sandbox of
their own, and that every action goes through OpenKumi's tools, which check where they reach.

## Plain http on the home network

On a home network the apps talk to the server over plain `http`. Pairing gives nothing away, but a
paired device's key travels with each request, so someone who can watch that network could copy
it.

**What to do:** pair and use OpenKumi on networks you trust (away from home it only works over
`https`), and remove devices you no longer use.

## Your computer account is the boundary

There are no user accounts in OpenKumi. Anyone who can use your account on the computer that runs
it can read its keys and use your bots. Keys and tokens are in files only your account can read,
but the `~/.openkumi` folder itself, the database (with conversations and webhook secrets) and the
bots' workspaces are created with your system's usual permissions, which on some systems lets other
accounts on the same computer read them.

**What to do:** on a computer shared with other people, make the folder private:

```sh
chmod 700 ~/.openkumi
```

The same holds between the people with bots on one computer
([Bots for someone else in the house](/environments/#bots-for-someone-else-in-the-house)): their
bots are kept apart in the app, but all their servers run under the one account, and their folders
lie side by side in `~/.openkumi/people/`.

## A bot's secrets are encrypted, the rest is not

What a bot keeps in its [vault](/secrets/) is encrypted, with a key that is kept outside the data
folder: in the Mac's keychain, by Windows for your account, in a Linux desktop's keyring, or
otherwise in a file under `~/.config/openkumi/keys/`. A copy of the data folder cannot be read
without it. A program that runs under your account can still ask for the key, as OpenKumi does.

Nothing else in the folder is encrypted yet: not the sign-ins of superpowers, the access code or
an API key in `auth.json`, nor the conversations.

## Keys on the desktop are in a file, not the keychain

The desktop app keeps the keys of remote environments in `desktop.json`, readable only by your
account, rather than in the system's keychain. (The iPhone app uses the keychain.) Someone who can
read your files can use those keys from your home network, or through an `https` address you put
in front of the server.

## Pages can load from the web

A page a bot shows cannot make requests, but it may load scripts, pictures and fonts from `https`
addresses, and such an address can carry something in it. A page only holds what the bot put into
it, never your keys or other conversations.

## Engines and services keep their own records

Claude Code, Codex and Grok keep their own records of the conversations they ran, and your AI plan,
the apps of superpowers and the sites bots visit see what is sent to them, under their own terms.
OpenKumi cannot delete what they keep.
