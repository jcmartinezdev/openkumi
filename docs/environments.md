# Where bots run, and reaching them

Bots run in an environment: a computer running the OpenKumi server. This is how the app finds one, how another computer or a phone is let in, and how that stays safe.

## Environments: where bots run

An environment is a computer running the OpenKumi server. They are set under **Settings →
Environments**:

- **Local environment.** A switch. On, the app runs the server on this computer, in a process of
  its own, with its data in `~/.openkumi`, and stops it when you quit. Off, no server runs here and
  bots only run in remote environments. If OpenKumi is already running on this computer when the
  app starts, the app uses that one and leaves it running.
- **Environments.** Other computers that run OpenKumi, each paired with this one. Each has a
  switch, one or more addresses, and can be renamed or removed.

## Pairing with another computer

1. On the computer that runs the bots: **Settings → Environments → Let other computers connect**,
   then **Pair a computer**. It shows its address and a code like `ABCD-EFGH-JKMN`. (With no app
   there, `npm run pair` prints the same.)
2. On the other computer: **Settings → Environments → Add environment**, and enter the address
   and the code.

The code works once, for ten minutes, and is never sent over the network: each computer shows the
other that it has the code by signing made-up values with it, so the app cannot be talked into
pairing with something else at that address, and the server only lets in a computer that was given
the code. The paired computer then gets a key of its own. The server lists the computers it has
let in, and **Remove** shuts one out at once without disturbing the others. Who gets in is decided
only at the computer that runs the bots.

The window shows one environment at a time. With more than one turned on, switch between them
from the sidebar or the **Environment** menu; the window stays as it is and only what it is
connected to changes.

## Reaching it from anywhere

An environment can have several addresses: its address on your home network, its address on
[Tailscale](https://tailscale.com), and any you add (the list of addresses beside it, in **Settings →
Environments**). The app tries them in that order and uses the first that answers, so at home it
goes straight there and away from home it goes over Tailscale. While connected it looks again every
minute, and whenever the network changes, and moves back home as soon as home answers.

You only pair once, wherever you are: the server tells the computers and phones paired with it its
other addresses, and they keep them up to date (a new address on the home network replaces the old
one). With Tailscale on both, nothing else needs setting up. Addresses you added yourself are only
changed by you.

A key never goes to an address just because it is saved. Before connecting, the app asks whatever
answers there who it is, without sending the key: the server has to sign a value the app made up
with the key's hash, which only that server and that device know. Something else at a saved address
(another device that got the same home address on another network, or another OpenKumi server) is
told nothing it could use, and an address where something else answers cannot be added. Plain
`http` is only used on the home network and on Tailscale, which encrypts the connection itself;
anywhere else an address needs `https`. The server itself only answers this computer, the local
network and Tailscale, and treats a request a proxy on this computer passes on as coming from
elsewhere.

A computer can also run the server with no app at all, for other computers to pair with: see
[Installing and updating](install.md) for the installed one (`openkumi lan on`, then `openkumi pair`). From the
source it is:

```sh
npm run server     # the server
npm run pair       # a code for pairing one more computer with it
```

## On an iPhone

There is an iPhone app (`apps/mobile`, Expo and React Native) for chatting with your bots,
watching and steering their browsers, and looking after them: its Settings (the gear on the list
of bots) change each bot's name, rules, model, browser and superpowers, switch providers on and off,
set what new bots start with, and choose light or dark and the size of messages on the phone.
Automations are at the bottom of the list of bots, as on the computer: turn them on and off,
run them, read their runs, and make or change them (a watch is set up on the computer, or by asking a bot). It pairs with a server the way another computer does: on
the computer that runs the bots choose **Pair a computer**, and in the phone app scan the QR code
it shows, or type the address and the code. The key the phone is given is kept in its keychain,
and the server lists the phone so you can remove it.

```sh
npm run mobile     # builds it and opens it in the iPhone simulator (needs Xcode and CocoaPods)
```

The phone reaches the server the same way, at each of its addresses in turn: at home over your
network, and anywhere else over Tailscale, on both. Its Settings list the addresses and which one
is in use, and one can be added there. Signing in to providers, files
and the Advanced settings are managed in the desktop app.

There is no web version: the server has no pages, and opening its address in a browser shows a
note saying so. The only way in is the app.

The app keeps its environments, with the key each one gave it, in a file only you can read
(`desktop.json` in the app's data folder, e.g. `~/Library/Application Support/OpenKumi`).
