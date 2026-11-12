# Open Bot

Open-source, local-first AI bots, as a desktop app. Bots run on your own computer, or on another
computer of yours that the app connects to. Each bot is a folder with its own instructions,
memory, files, skills and connections, plus its own conversation, subagents and a private web browser
that stays logged in.

- **Bring the subscription you already have.** Bots run on Codex (your ChatGPT plan), Claude Code
  (your Claude plan) or Grok (your Grok plan): if the program is installed and signed in on the
  computer, Open Bot uses it. No API key. Settings shows whether each one is connected; a bot's
  settings choose what it runs on.
- **Or no subscription at all.** Local models through Ollama or LM Studio are found by themselves
  when the program is running. Other models plug in through any OpenAI-compatible endpoint
  (OpenAI API, OpenRouter).
- **One conversation per bot.** A bot is someone you talk to, not a list of chats: whatever you
  say lands in the same conversation, and the bot can look up anything said in it, however long
  ago. Start fresh when you want an empty page; the conversation so far is kept, to read, search
  or continue.
- **Subagents.** A bot can split work into parallel subagents, each in its own thread. Watch them
  live, open one to read or message it, or stop it. Results flow back to the parent automatically.
- **A browser per bot.** Every bot gets its own Chrome profile. Sign in to a site once in the
  built-in browser panel and that bot stays signed in; nothing is shared between bots or with your
  own browser. You can watch the bot browse and take over at any time.
- **Bots that write their own instructions.** A bot keeps an `AGENTS.md` and a `memory/` folder
  and updates them as it learns how you want it to work. Every change it makes is recorded, shown
  in the app, and can be undone.
- **Skills and connections you switch on.** A catalog of skills (the `SKILL.md` format Claude Code
  and Codex use) and MCP servers, toggled per bot. Each bot signs in to a server with its own
  account. A bot can use what you give it but cannot change it or give itself more.
- **Plugins.** Ready-made abilities you install for one bot at a time: Gmail, Google Calendar,
  Google Drive, Notion and Linear to start with. Each has a page that says what it does; installing
  gives that bot the skill and the connection it needs.
- **Replies you can look at.** Replies are drawn with code in colour (with a copy button), tables
  that scroll sideways, ```` ```mermaid ```` diagrams and formulas. A bot can also show a page in
  the conversation (a chart, a dashboard, a timeline), drawn in the app's light or dark colours,
  on the computer and on the phone.
- **Principles every bot follows, and a team that knows itself.** One set of principles, yours to
  change, is what every bot is told before anything else. Each bot is also told who the other bots
  are and what each is for, so it hands a task to the one it fits.
- **Bots that make bots.** Create bots in the app, or just ask in chat.
- **A mascot for every bot.** Each bot is a little jelly creature holding a sign with its emoji.
  Choose its creature, colour, hat, extra and clothes, or leave it and the new bot dresses itself
  from its name and what it is for. Its look is a line in `bot.md` (`look: cat sky cap orange`).

## Run it

Requires Node.js 22.18+ and Google Chrome, plus something for the bots to run on: the Codex CLI
(`codex login`), Claude Code (`claude`) or Grok Build (`grok login`), signed in; or Ollama or LM
Studio running; or an OpenAI-compatible API. With git
installed, each bot's changes to its own files are kept as a history you can undo.

```sh
npm install
npm start          # builds the app and opens it
npm run dist       # builds an installer into release/ (a .dmg on macOS)
```

The first time, the app asks where your bots should run. Check under **Settings → Providers** that
something shows as connected, then start chatting.

### Environments: where bots run

An environment is a computer running the Open Bot server. They are set under **Settings →
Environments**:

- **Local environment.** A switch. On, the app runs the server on this computer, in a process of
  its own, with its data in `~/.openbot`, and stops it when you quit. Off, no server runs here and
  bots only run in remote environments. If Open Bot is already running on this computer when the
  app starts, the app uses that one and leaves it running.
- **Environments.** Other computers that run Open Bot, each paired with this one. Each has a
  switch, and can be renamed or removed.

### Pairing with another computer

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
connected to changes. Reaching another computer works over your local network for now.

A computer can also run the server with no app at all, for other computers to pair with:

```sh
npm run server     # the server
npm run pair       # a code for pairing one more computer with it
```

### On an iPhone

There is an iPhone app (`apps/mobile`, Expo and React Native) for chatting with your bots,
watching and steering their browsers, and looking after them: its Settings (the gear on the list
of bots) change each bot's name, rules, model, browser and skills, switch providers on and off,
set what new bots start with, and choose light or dark and the size of messages on the phone.
Scheduled tasks are at the bottom of the list of bots, as on the computer: turn them on and off,
run them, read their runs, and make or change them. It pairs with a server the way another computer does: on
the computer that runs the bots choose **Pair a computer**, and in the phone app scan the QR code
it shows, or type the address and the code. The key the phone is given is kept in its keychain,
and the server lists the phone so you can remove it.

```sh
npm run mobile     # builds it and opens it in the iPhone simulator (needs Xcode and CocoaPods)
```

The phone reaches the server over your network, so it works at home, or anywhere with a private
network such as Tailscale on both. Signing in to providers, plugins, connections, files and
the Advanced settings are managed in the desktop app.

There is no web version: the server has no pages, and opening its address in a browser shows a
note saying so. The only way in is the app.

The app keeps its environments, with the key each one gave it, in a file only you can read
(`desktop.json` in the app's data folder, e.g. `~/Library/Application Support/Open Bot`). Builds
are signed with whatever certificate the build machine has and are not notarized, so an installer
you hand to someone else will be flagged by macOS until that is set up.

### Settings

Everything is set from the Settings page, which saves each change as you make it:

| Page | What it holds |
| --- | --- |
| General | what a new bot starts with; sidebar and confirmation preferences |
| Appearance, Chat | theme, text size, how Enter behaves, how much detail a step shows (kept per device) |
| Providers | Codex and Claude Code (status, program path), other models; switch any of them off |
| Bots | every bot: what it is for, its rules, model, skills, connections and files |
| Principles | what every bot is told first; what each bot is for; everything a bot is told, to read |
| Browser | which browser program the bots drive, and which bots have one running |
| Plugins | ready-made abilities to browse and install for a bot |
| Skills, Connections | the two catalogs, and which bots use what |
| Environments | the local environment (on or off) and remote ones; letting other computers connect to the one being shown, its link and access code |
| Advanced | limits (steps per turn, subagents), troubleshooting, the data folder |

App-wide settings are stored in `~/.openbot/settings.json` (only values that differ from the
defaults). Preferences marked "this device" stay in the app on that computer.

### Working on it

```sh
npm run dev         # the app, with the interface reloading as you edit apps/web
npm test            # the server's end-to-end tests, then the desktop app's
npm run typecheck
```

The tests use a scripted offline model, a real headless Chrome for the bots, and the real app
with its window kept off the screen. Everything they touch is temporary. To test a packaged app
instead of the source: `OPENBOT_DESKTOP_APP="release/mac-arm64/Open Bot.app/Contents/MacOS/Open Bot" npm test -w @openbot/desktop`.

## How it works

```
apps/
  server/            the server: runs the bots. Node, straight from TypeScript, no build step
    src/
      agent.ts         the agent loop, the system prompt and subagent orchestration
      tools.ts         tools the model can call (bots, files, subagents, browser, web)
      bots.ts          bots as folders: bot.md and what sits beside it
      workspace.ts     a bot's own files: path confinement, file operations, git history
      skills.ts        the skill catalog and each bot's links into it
      connections.ts   MCP servers: catalog, per-bot connections and sign-in
      browser.ts       one persistent Chrome profile per bot; live view via CDP screencast
      providers/       what bots run on: the Codex and Claude Code engines (codex.ts,
                       claude-code.ts, grok.ts), local models, OpenAI-compatible APIs, a mock for tests
      tool-endpoint.ts serves a bot's tools to an engine over MCP for the length of one turn
      settings.ts      app-wide settings, kept in settings.json
      http.ts          the API and the stream of events. No pages
      history.ts       what a model is shown of a long conversation: trimming, and the summary of its older part
      db.ts            SQLite (conversations and messages)
    skills/            the skills that ship with Open Bot
  web/               the interface (React, Vite). Built into the desktop app; nothing serves it
    src/
      store.ts               the window's copy of the environment it shows
      connection.worker.ts   the connection to the environment, on a thread of its own
  desktop/           the desktop app (Electron)
    src/
      main.ts          the window, the menu, and what the window may ask for
      local.ts         the local environment: the server, in a process of its own
      environments.ts  the list of environments and their access codes
      protocol.ts      hands the interface to the window under the app's own address
      preload.ts       the bridge between the window and the app
  mobile/            the iPhone app (Expo, React Native): pairing, each bot's conversation, a bot's browser,
                     settings and scheduled tasks
packages/
  shared/            the types every app agrees on
  client/            what every app needs to talk to a server: the connection, the state
                     kept from it, pairing. Used by the desktop window and the phone app
```

### One app, several processes and threads

The app is not a web page in a window. Its work is spread out so that no part can hold up another:

| Where | What runs there |
| --- | --- |
| The app's main process | the window, the menu, the list of environments. It does no work of its own |
| A process of its own (`Open Bot Server`) | the server, when the local environment is on. Each bot's Chrome, and each Claude Code or Codex turn, is a further process the server starts |
| The window | the interface, loaded from the app itself (`openbot://app/`), talking straight to the environment it shows |
| A worker thread in the window | the connection to the environment: it reads what arrives, hands changes to the window at most once per frame, and draws the pictures of a bot's browser straight onto the page |

Two things follow for speed. Text that streams in is collected on the worker and applied once per
frame, and a reply being written is drawn piece by piece, so only its last paragraph is worked out
again as it grows. Pictures of a bot's browser arrive as bytes and are decoded and drawn by the
worker; they never pass through the window's own thread. Measured on the packaged app (M-series
Mac): the app is usable about 0.6 s after it starts, server included, and while a 6,000-word reply
streamed in beside a browser page that changed on every frame, the window kept drawing 60 frames a
second with no frame longer than 19 ms.

### Where everything lives

An environment keeps everything in `~/.openbot` (override with `OPENBOT_HOME`). The app's settings
screens only read and write these files, so you can also edit them by hand.

```
~/.openbot/
  skills/<name>/SKILL.md     the skill catalog; add a skill by dropping its folder here
  mcp.json                   the connection catalog (same "mcpServers" format other MCP clients use)
  principles.md              yours: what every bot is told first (only once you change the ones Open Bot comes with)
  bots/<id>/
    bot.md                   yours: name, what it is for, model and the rules the bot must follow
    skills/                  links to the catalog skills switched on for this bot
    mcp.json                 the connections switched on for this bot
    plugins.json             the plugins installed for this bot
    workspace/               the bot's own, and the only place its file tools reach
      AGENTS.md              its instructions, which it writes and updates itself
      memory/                its notes; only the list is loaded, it reads a note when needed
      files/                 working files and browser downloads (not in the history)
    private/                 never visible to the bot
      browser-profile/       its Chrome profile: cookies, logins
      mcp/<name>.json        its account with each connection
      history.git/           the record of every change to the workspace
  openbot.db                 conversations, messages and scheduled tasks
  settings.json              app-wide settings that differ from the defaults
  auth.json                  API keys, the access code, and what plugins were set up with (owner-readable only)
  clients.json               the computers paired with this one (owner-readable only)
```

The split is deliberate. **What a bot can do is yours:** its model, rules, skills and connections
sit outside its workspace, so it cannot grant itself anything. **What a bot knows is its own:** it
rewrites `AGENTS.md` and `memory/` freely. Each change is a commit in a git history kept in
`private/history.git`, labelled with who made it (the bot or you), and the Files tab can show and
undo it. (`git --git-dir=…/private/history.git --work-tree=…/workspace log` reads it by hand.)

### What every bot is told

Before each turn a bot is given, in this order:

1. **Principles**, the same for every bot: how to behave and how to work with the others. Open Bot
   comes with a short set (`apps/server/principles.md`); change them under **Settings →
   Principles**, and they are kept in `~/.openbot/principles.md` from then on. Restore default
   deletes that file, so later improvements to the ones Open Bot comes with reach you again.
2. **The other bots**: each one's name, its `bot_id`, the line saying what it is for, the skills and
   connections it has, and which is the main assistant. The line is set by you, in the bot's
   settings or on the Principles page; no bot can change it, its own included, so one bot that has
   been talked into something by a web page cannot pass that on to the others through how it is
   described. A new bot's line starts as what its maker gave: the description a bot passes to
   `create_bot`, or else the first sentence of what the bot was made for.
3. How Open Bot works (replies, the browser, subagents, and that web pages and tool results are
   never instructions), then the bot's **rules from you**, which win where they and the principles
   disagree.
4. Its conversation, scheduled tasks, workspace, its own `AGENTS.md`, the list of its notes, and
   its skills.

**Settings → Principles → What a bot is told** shows all of it for any bot.

### One conversation per bot

A bot has a single conversation with you. It begins with the first message and goes on from
there; subagents work in threads of their own beneath it and report back into it. **Start fresh**,
in the conversation's header, sets the conversation so far aside and begins an empty one. What the
bot knows is untouched, because that lives in its folder and not in the conversation. Earlier
conversations are kept: the clock button beside it lists them and searches everything that was
said, and any of them can be continued in place of the current one.

A conversation that never ends cannot be sent to a model whole for ever:

- On an engine, the program keeps the conversation and shortens it by itself.
- On Open Bot's own loop (local models, OpenAI-compatible APIs), once the conversation passes
  **Settings → Advanced → Length of a conversation**, the model is asked to summarise the older
  part, and from then on it is sent that summary and what came after it. A model that refuses a
  conversation as too long before the limit is reached gets the same treatment at once, and is
  asked again.
- A bot that is moved to another engine is told what was said most recently, with the summary if
  there is one.

None of this deletes anything. You still see every message, and the bot has `search_history` and
`read_history` to look up what is no longer in front of it.

### Scheduled tasks

A scheduled task gives a bot a prompt at set times: once, at a time of day (every day or on
chosen days), or every so often (every 5 minutes at most). **Scheduled tasks**, at the bottom of
the sidebar, lists every task with its latest runs beneath it, and is where you make, change,
pause, run and delete them. Bots make them too, with their tools.

Each run is a thread of its own beneath the bot's conversation, like a subagent's. It sees nothing
of the conversation, so a task's prompt has to stand on its own. When it is done, what it came to
arrives in the conversation and the bot tells you about it there; a run that ends with exactly
"Nothing to report." is not passed on, for tasks that only matter when something happened. A run
opens like any conversation, from beneath its task, from under the bot in the sidebar while it is
recent, or from its result in the conversation. The latest 50 runs of each task are kept.

Who may do what:

- You can make, change and delete any task.
- A bot schedules tasks only for itself. It sees the tasks it does and the ones it made, and
  changes or deletes only the ones it made.
- The **main assistant**, the first bot (marked in **Settings → Bots**), schedules tasks for every
  bot, and sees, changes and deletes every task.
- A run is told who set the task up. One a bot wrote is not taken as your go-ahead: a purchase,
  a message to send or something to delete is left for you, and said so in its result.

Times of day keep to the time zone of the computer running Open Bot, also across a change of the
clocks. When that computer was asleep or off, a run at a time of day that is more than ten minutes
late is marked as missed and the next one is awaited; a task that runs once, or every so often,
runs as soon as it can.

### Replies and pages

Replies are GitHub Markdown, drawn the same way in the desktop app and on the phone: code in
colour with its language and a copy button, tables that scroll sideways instead of squeezing,
diagrams from ```` ```mermaid ```` blocks (with their code a tap away), and formulas, written as
`$…$` within a line or as `$$…$$` on lines of their own. A dollar sign followed by a space or a
digit is a price, not a formula. A long run of steps between two messages is folded into one line
once it is over ("12 steps · 1m 04s").

When a picture says more than words, a bot calls `show_page` with a self-contained HTML page: a
chart, a dashboard, a timeline, a mockup. It appears in the conversation where the bot's reply is,
fitted to its height, and opens full size. The page is written against the app's colours as CSS
variables (`--foreground`, `--card`, `--chart-1` to `--chart-8`, chosen to stay apart for
colour-blind readers, and so on), so it follows light and dark mode. Pictures from the bot's
workspace are put into the page, so it keeps working when the files change. An ```` ```html ````
block in a reply can be previewed the same way.

A page runs in a frame that is a site of its own (`openbot://page/` on the computer, a separate web
view on the phone). Its scripts run, and it may load scripts, styles, fonts and pictures from the
web (a chart library from a CDN), but it cannot reach the app or its keys, fetch or send anything,
or go to another site. Links in it open in your browser when you click them, and only then. On the
phone, Mermaid and KaTeX are loaded from jsDelivr when a diagram or formula is drawn.

### Plugins

A plugin is a folder in `apps/server/plugins/<id>`:

```
plugin.json     name, tagline, category, what a bot can do with it, the skills and the connection it brings
README.md       the plugin's page in the app
skills/<name>/SKILL.md
```

Installing one for a bot switches its skills on for that bot and, when it has one, switches its
connection on for that bot; the bot then signs in to the service with its own account. Nothing is
installed for all bots at once. A plugin adds nothing a skill and a connection could not be set
up to do by hand; it is the two put together, with an explanation.

The Google plugins work in two ways. With nothing set up, the bot uses the service through its
own browser, signed in there by you. Google also offers a direct connection (in developer
preview), which needs a client you create once in Google Cloud; each plugin's page has the steps,
and the three share the client. Notion and Linear need no setup: install, then sign in.

### Tools available to a bot

| Area | Tools |
| --- | --- |
| Bots | `list_bots`, `create_bot` |
| Files | `list_files`, `read_file`, `write_file`, `edit_file`, `search_files`, `move_file`, `delete_file` |
| Its conversation | `search_history`, `read_history` |
| Subagents | `spawn_subagent`, `wait_subagents`, `list_subagents`, `read_subagent`, `message_subagent`, `cancel_subagent` |
| Scheduled tasks | `list_scheduled_tasks`, `schedule_task`, `update_scheduled_task`, `delete_scheduled_task` |
| Browser | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select`, `browser_upload`, `browser_press_key`, `browser_scroll`, `browser_back`, `browser_read`, `browser_eval` |
| Web | `web_fetch`, plus the provider's built-in web search |
| The conversation | `show_page` |
| Connections | every tool of each MCP server switched on for the bot, named `mcp__<connection>__<tool>` |

There is no shell tool. Skills are instructions: a skill that ships scripts can be read, but its
scripts are not run.

A subagent can run as a different bot (`spawn_subagent` with `bot_id`), which is how bots hand
work to each other: the other bot does the task as itself, with its own instructions, logins and
connections, is told which bot handed it over, and reports back to that bot. Subagents can nest
two levels deep; each gets its own browser tab.

### Engines: Claude Code, Codex and Grok

Bots run on an engine by default. An engine is a program that keeps the conversation and runs the
model-and-tools loop itself. (Open Bot also has a loop of its own, which asks a model for one step
at a time; it is what bots on local models or an OpenAI-compatible API run on.) Open Bot starts
the `claude`, `codex` or `grok` program installed on the computer for each turn, gives it the bot's instructions and
what was said since it last ran, and serves the bot's tools to it over MCP at an address that
exists only for that turn. Tool calls are carried out and recorded the same way on either path.

The engines are started with their own tools for running commands and touching files switched
off, and without your personal setup in them (settings, instruction files, skills, plugins, MCP
servers), with one exception noted below for Grok. A bot on an engine can therefore do exactly what it can do on Open Bot's
own loop. What changes is whose model and account it runs on.

- You sign in to each program yourself (`claude`, `codex login`, `grok login`); Open Bot never sees the
  credentials. Usage counts against that account.
- Each program keeps its own record of the conversations it ran (under `~/.claude` and
  `~/.codex`).
- Replies from Codex appear a message at a time rather than word by word.
- Grok takes an MCP server only from a settings file in a folder it has been told to trust. Open
  Bot keeps a folder for that inside each bot (`private/grok/`), so Grok's own list of trusted
  folders (`~/.grok/trusted_folders.toml`) gains an entry per bot. Grok's skill list is not
  switched off; with its tools off, a skill there has nothing to act with.

### Local models

Start Ollama or LM Studio on the computer that runs the bots and it shows up under **Settings →
Providers → Local models**, with the models it has; a bot's settings then offer them. For another
program or port, enter its address there. Bots need a model that can call tools, and small models
are often poor at it: expect a bot on one to be less capable than on the engines above.

### Adding a model provider

Implement the `Provider` interface in `apps/server/src/providers/types.ts` and register it in
`apps/server/src/providers/index.ts`. A provider has `info` and `models`, and either `stream` (answer one
model request; Open Bot runs the tools) or `turn` (run a whole turn, as the engines do). The agent
loop only deals in the neutral item types from `packages/shared/src/types.ts`; each provider converts those to
and from its own format.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENBOT_PORT` | `4317` | the server's port |
| `OPENBOT_LAN` | unset | `1` lets other computers on the network connect whatever Settings says (same as `--lan`) |
| `OPENBOT_HOME` | `~/.openbot` | data directory |
| `OPENBOT_BROWSER_CHANNEL` | from Settings | Playwright browser channel (`chrome`, `msedge`, …); overrides Settings |
| `OPENBOT_MOCK` | unset | set to `1` to enable the scripted offline provider used by tests |
| `OPENBOT_CLAUDE_BIN`, `OPENBOT_CODEX_BIN`, `OPENBOT_GROK_BIN` | from Settings, else found on `PATH` | where the `claude`, `codex` and `grok` programs are; overrides Settings |
| `OPENBOT_DEBUG` | from Settings | set to `1` to log everything an engine prints |

## Security notes

- Every request to the server has to carry a key. Nothing is trusted for where it comes from and
  there are no cookies, so a web page open in a browser has no way in, and only the app's own pages
  may read the server's answers. On the computer the server runs on, the key is its access code
  (in `auth.json`), which the app there reads from the data folder and which is refused from
  anywhere else. Every other computer is paired (see above) and holds a key of its own, kept by
  the server only as a hash in `clients.json`.
- By default the server listens on `127.0.0.1` only; with network access on it listens on the
  local network too. Traffic there is plain HTTP: pairing does not give its code away to someone
  listening, but a paired computer's key travels with each request, so someone who can watch the
  network could copy it. Use it only on networks you trust, and remove a computer you no longer
  use. There are no user accounts: anyone with access to your OS user account can use it.
- The app's window only ever loads the app's own page, and that page runs scripts only from the
  app's own files. Links, and sign-in pages for connections, open in your browser. Pages that
  bots show run in frames that are sites of their own and cannot reach the app (see *Replies and
  pages*).
- A bot's browser holds real logins. Web pages can contain text written to manipulate an AI
  ("prompt injection"). Bots are instructed to treat page content as data and to confirm before
  purchases, sending messages or deleting things, but that is a mitigation, not a guarantee. Give a
  bot only the logins you are comfortable with it using.
- A bot that edits its own instructions can be talked into a bad edit by something it reads. Two
  things limit that: the rules in `bot.md` are outside its reach, and every change to `AGENTS.md`
  and `memory/` is in the history where you can undo it.
- A bot's browser and `web_fetch` cannot open files on the computer or Open Bot's own address.
  Without that, a bot could read your keys, or open the app as you and change its own rules.
- A skill is instructions the bot will follow with its browser and accounts, and a connection that
  runs a local program runs it as you. Switch on only ones you trust. Local programs can be added
  only from the computer running Open Bot, not from another computer on the network.
- Signing in to a connection finishes at `http://localhost:<port>`, so it has to be done in a
  browser on the computer running Open Bot.

## Not built yet

Image attachments, running commands in a sandbox (and with it, skills that ship
scripts), and native Anthropic/Gemini providers.

## License

MIT
