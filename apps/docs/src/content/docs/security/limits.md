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

## A saved login is the whole account

A [login](/secrets/#logins) lets a bot sign in to a site by itself. The bot never sees the
password, the model's service is never sent it, and it is kept encrypted. It is still not
completely safe:

- **Anyone who can use your account on the computer that runs OpenKumi can get the passwords.**
  In the app on that computer, **Show** displays one. A program that runs as you can ask for the
  vault's key as OpenKumi does and decrypt them all. While the server runs, a password it has
  used is in its memory. On a computer several people share under one account, that includes
  them.
- **The bot acts as you on that site.** Signed in, it can do whatever the account can, in its
  conversation and in runs nobody watches, and it can be [misled](#bots-can-be-misled) by what it
  reads there. Not seeing the password does not limit what it does with the account.
- **What you type is read to make the offer.** While you have control of a bot's browser, the
  server reads the sign-in form you fill in, so that it can ask whether to save it. It holds the
  password in memory until you answer, for ten minutes at most, and keeps nothing if you say no.
  While it holds the password, it takes it out of what the bot reads.
- **A password you make visible can be read.** A bot reads the pages in its browser, and a
  password field hides what is in it. If you use a site's "show password" while you type by
  hand and leave it showing, the bot can read it once the server no longer holds it. Hide it
  again, or send the form, before you hand the window back.
- **The password goes where the site's form sends it.** It is only entered on a page of the
  login's site, and not into a form that says it sends to another site. What the site's own
  scripts do with it after that is the site's business.
- **A sign-in outlives the password.** The bot's browser profile, and the cookies kept beside
  it, hold the bot's sign-ins. A copy of the profile may be enough to be signed in as the bot,
  whatever becomes of the saved password.
- **Signing in by itself is new.** It has so far been tried against test pages, not against
  many real sites. A site may also treat repeated automatic sign-ins as suspicious and lock the
  account.

**What to do:**

- Give a bot an account of its own where the site allows it, with only the rights its work needs.
- Never save the password of your main e-mail, your bank or your password manager, nor a
  password you use on more than one site.
- Keep two-factor sign-in on for accounts that matter. The bot then needs you for the code,
  which is the point.
- Lock the computer that runs OpenKumi when you leave it, and keep its disk encrypted.
- Remove a login the bot no longer needs. If the computer is lost or somebody else got into it,
  change those passwords on the sites themselves and sign the sessions out there.

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
