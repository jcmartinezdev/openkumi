# Open Bot

Open-source, local-first AI bots, as a desktop app. Bots run on your own computer, or on another
computer of yours that the app connects to. Each bot is a folder with its own instructions,
memory, files, skills and connections, plus its own chats, subagents and a private web browser
that stays logged in.

- **Bring the subscription you already have.** Bots run on Codex (your ChatGPT plan) or Claude
  Code (your Claude plan): if the program is installed and signed in on the computer, Open Bot
  uses it. No API key. Settings shows whether each one is connected; a bot's settings choose what
  it runs on. Other models plug in through any OpenAI-compatible endpoint (OpenAI API, OpenRouter,
  Ollama, LM Studio).
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
- **Bots that make bots.** Create bots in the app, or just ask in chat.

## Run it

Requires Node.js 22.18+ and Google Chrome, plus something for the bots to run on: the Codex CLI
(`codex login`) or Claude Code (`claude`), signed in, or an OpenAI-compatible API. With git
installed, each bot's changes to its own files are kept as a history you can undo.

```sh
npm install
npm start          # builds the app and opens it
npm run dist       # builds an installer into release/ (a .dmg on macOS)
```

The first time, the app asks where your bots should run. Check under **Settings → Providers** that
Codex or Claude Code shows as connected (or add another model there), then start chatting.

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
| Bots | every bot: its rules, model, skills, connections and files |
| Browser | which browser program the bots drive, and which bots have one running |
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
                       claude-code.ts), OpenAI-compatible APIs, and a mock for tests
      tool-endpoint.ts serves a bot's tools to an engine over MCP for the length of one turn
      settings.ts      app-wide settings, kept in settings.json
      http.ts          the API and the stream of events. No pages
      db.ts            SQLite (chats and messages)
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
packages/
  shared/            the types all three agree on
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
  bots/<id>/
    bot.md                   yours: name, model and the rules the bot must follow
    skills/                  links to the catalog skills switched on for this bot
    mcp.json                 the connections switched on for this bot
    workspace/               the bot's own, and the only place its file tools reach
      AGENTS.md              its instructions, which it writes and updates itself
      memory/                its notes; only the list is loaded, it reads a note when needed
      files/                 working files and browser downloads (not in the history)
    private/                 never visible to the bot
      browser-profile/       its Chrome profile: cookies, logins
      mcp/<name>.json        its account with each connection
      history.git/           the record of every change to the workspace
  openbot.db                 chats and messages
  settings.json              app-wide settings that differ from the defaults
  auth.json                  API keys and the access code (owner-readable only)
  clients.json               the computers paired with this one (owner-readable only)
```

The split is deliberate. **What a bot can do is yours:** its model, rules, skills and connections
sit outside its workspace, so it cannot grant itself anything. **What a bot knows is its own:** it
rewrites `AGENTS.md` and `memory/` freely. Each change is a commit in a git history kept in
`private/history.git`, labelled with who made it (the bot or you), and the Files tab can show and
undo it. (`git --git-dir=…/private/history.git --work-tree=…/workspace log` reads it by hand.)

### Tools available to a bot

| Area | Tools |
| --- | --- |
| Bots | `list_bots`, `create_bot` |
| Files | `list_files`, `read_file`, `write_file`, `edit_file`, `search_files`, `move_file`, `delete_file` |
| Subagents | `spawn_subagent`, `wait_subagents`, `list_subagents`, `read_subagent`, `message_subagent`, `cancel_subagent` |
| Browser | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select`, `browser_upload`, `browser_press_key`, `browser_scroll`, `browser_back`, `browser_read`, `browser_eval` |
| Web | `web_fetch`, plus the provider's built-in web search |
| Connections | every tool of each MCP server switched on for the bot, named `mcp__<connection>__<tool>` |

There is no shell tool. Skills are instructions: a skill that ships scripts can be read, but its
scripts are not run.

A subagent can run as a different bot (`spawn_subagent` with `bot_id`), which is how bots hand
work to each other. Subagents can nest two levels deep; each gets its own browser tab.

### Engines: Claude Code and Codex

Bots run on an engine by default. An engine is a program that keeps the conversation and runs the
model-and-tools loop itself. (Open Bot also has a loop of its own, which asks a model for one step
at a time; it is what bots on an OpenAI-compatible API run on.) Open Bot starts the `claude`
or `codex` program installed on the computer for each turn, gives it the bot's instructions and
what was said since it last ran, and serves the bot's tools to it over MCP at an address that
exists only for that turn. Tool calls are carried out and recorded the same way on either path.

Both engines are started with their own tools for running commands and touching files switched
off, and without your personal Claude Code or Codex setup (settings, instruction files, skills,
plugins, MCP servers). A bot on an engine can therefore do exactly what it can do on Open Bot's
own loop. What changes is whose model and account it runs on.

- You sign in to each program yourself (`claude`, `codex login`); Open Bot never sees the
  credentials. Usage counts against that account.
- Each program keeps its own record of the conversations it ran (under `~/.claude` and
  `~/.codex`).
- Replies from Codex appear a message at a time rather than word by word.

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
| `OPENBOT_CLAUDE_BIN`, `OPENBOT_CODEX_BIN` | from Settings, else found on `PATH` | where the `claude` and `codex` programs are; overrides Settings |
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
  app's own files. Links, and sign-in pages for connections, open in your browser.
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

Conversation compaction for very long chats on Open Bot's own loop, image attachments, scheduled
runs, running commands in a sandbox (and with it, skills that ship scripts), and native
Anthropic/Gemini providers.

## License

MIT
