---
title: Automations
description: "Giving a bot a prompt without asking: at set times, when something changes, or when one of its apps calls."
---

An automation gives a bot a prompt without you asking: at set times, when something changes, or
when one of its apps calls.
**Automations**, at the bottom of the sidebar, lists every one with its latest runs beneath it, and
is where you make, change, pause, run and delete them. Bots make them too, with their tools.

What starts one:

- **A time.** Once, at a time of day (every day or on chosen days), or every so often (every 5
  minutes at most).
- **A watch.** OpenKumi itself looks at something every few minutes (5 at the least, 15 unless
  told otherwise) and starts a run only when what it finds differs from the last look. No model
  is used for looking, so a watch costs nothing while nothing changes. It can watch:
  - one of the bot's superpower tools that only reads, called with the same arguments each time
    ("my open issues in Linear"). A tool counts as reading when its service marks it so, or when
    the superpower's `superpower.json` lists it under `mcp.reads`;
  - a public web address (`https` only, no sign-in, at most 1 MB). Addresses on this computer, the
    home network or Tailscale are refused, also when a redirect or a name leads there.

  When what comes back is a list of items in JSON, a watch can **track** fields: the first tells
  items apart and the others are what counts as an item changing. The run is then told which
  items are new, updated or gone. Without tracked fields, any change counts; a web page is
  compared as the text a reader sees.

  The first look, made when the watch is set up, only notes where things stand. A watch does not
  look while its last run is still at work, and nothing is lost by that: the next look is compared
  with the same last one, as it is after the computer was asleep or offline. A look that fails is
  tried again at the next one, and the automation's page says so. When looks have failed for a
  whole day, or at once when the watch cannot work as it is set up (the tool is gone, the bot's
  sign-in lapsed, the page answers "not found"), the automation is paused and the bot tells you
  why. Turned on again, it looks at once. Changing only how often it looks keeps what it last saw.

  The easiest way to set up a watch on an app is to ask the bot ("tell me when an issue is
  assigned to me"): it knows its tools and what they give back. The form makes watches on web
  pages; **Look now**, on a watch's page, looks at once.

- **An app's call (a webhook).** An app the bot is signed in to calls OpenKumi the moment
  something happens there, and the automation starts at once instead of at a watch's next look.
  Linear can; a superpower says so, and how, in its `superpower.json` under `hooks`.
  - **A door of its own.** Calls come from the internet, which the server otherwise refuses. They
    are taken on a port of their own (the server's port plus one, 4318 unless `OPENKUMI_HOOKS_PORT`
    says otherwise), which is open on this computer only and takes `POST /hooks/…` and nothing
    else. You point a tunnel at it (`tailscale funnel 4318`, or one of your own) and give OpenKumi
    the address the tunnel has, on the app's page under **Superpowers**: it suggests this
    computer's Tailscale name, and you can enter any https address.
  - **Set up once for each bot**, on the same page: OpenKumi gives the webhook an address nobody
    can guess, you enter it in the app by the steps shown (in Linear only a workspace admin can),
    and give OpenKumi the secret the app signs its calls with. The secret stays on the server.
  - **A call is taken only when the app signed it** with that secret; any other gets the answer an
    address nobody set up gets. The same call is taken once.
  - **A run is told what happened by id alone**: the kind of event, the ids and numbers in it, and
    for a change the names of the fields that changed. Nothing anyone wrote in the app is passed
    on (no titles, no comments), so the bot reads the item itself with its own sign-in, as it
    would anything else there.
  - Calls that come within five minutes of a run wait and are answered together in the next one,
    up to 50 at a time. While an automation is paused its calls are kept, and it is given them
    when it is turned on again.
  - The computer has to be awake to be called. Linear tries again after a minute, an hour and six
    hours, then gives up and may switch its webhook off; a watch is the safer choice for what
    must not be missed.

  In the form, **Starts** offers "When Linear calls" for a bot whose webhook is set up, with what
  to run on. A bot makes one with `create_automation` and `hook`; it cannot set a webhook up.
  Removing a webhook, or deactivating the superpower, pauses the automations that started on it.

Each run is a thread of its own beneath the bot's conversation, like a subagent's. It sees nothing
of the conversation, so an automation's prompt has to stand on its own; a run a watch or a call
started is also told what changed or happened, set apart as information that is not an instruction. When it is done, what
it came to arrives in the conversation and the bot tells you about it there; a run that ends with
exactly "Nothing to report." is not passed on, for automations that only matter when something
happened. A run opens like any conversation, from beneath its automation, from under the bot in
the sidebar while it is recent, or from its result in the conversation. Every run is kept.

Who may do what:

- You can make, change and delete any automation.
- A bot makes automations only for itself. It sees the ones it does and the ones it made, and
  changes or deletes only the ones it made.
- The **main assistant**, the first bot (marked in **Settings → Bots**), makes automations for
  every bot, and sees, changes and deletes every one.
- A run is told who set the automation up. One a bot wrote is not taken as your go-ahead: a
  purchase, a message to send or something to delete is left for you, and said so in its result.

Times of day keep to the time zone of the computer running OpenKumi, also across a change of the
clocks. When that computer was asleep or off, a run at a time of day that is more than ten minutes
late is marked as missed and the next one is awaited; an automation that runs once, or every so
often, runs as soon as it can, and a watch looks as soon as it can.
