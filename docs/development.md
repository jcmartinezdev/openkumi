# Working on OpenKumi

## Running it from the source

Node.js 22.18 or later, and Xcode's command line tools on a Mac for dictation.

```sh
npm install
npm start           # builds the app and opens it
```

```sh
npm run dev         # the app, with the interface reloading as you edit apps/web
npm test            # the server's end-to-end tests, then the desktop app's
npm run typecheck
npm run site        # the website (apps/marketing), at http://localhost:4321
npm run docs        # the documentation (apps/docs), at http://localhost:4322
```

The tests are run with Node.js 26 (`node --test test/` needs it). They use a scripted offline model, a real headless Chrome for the bots, and the real app
with its window kept off the screen. Everything they touch is temporary: a test sets
`OPENKUMI_HOME` to a folder of its own before it loads anything from `apps/server/src`, and
`config.ts` refuses to load under `node --test` without it, since it would otherwise use the data
of whoever runs the tests. The person's data folder inside it is `dataOf(home)` in the tests that
need it. To test a packaged app instead of the source:
`OPENKUMI_DESKTOP_APP="release/mac-arm64/OpenKumi.app/Contents/MacOS/OpenKumi" npm test -w @openkumi/desktop`.

Bots belong to a person, and each person on a computer has a server of their own
(`apps/server/src/people.ts`). From the source, `npm run server` runs everyone's, and the people
are looked after with the same command as on a server installed alone:

```sh
npm run openkumi -- people add ana      # a second person, on port 4427
npm run openkumi -- people              # who has bots here, and whether each one's server runs
npm run openkumi -- pair --for ana      # a code for their app
npm run openkumi -- start --for ana     # only their server
```

## Beside an installed OpenKumi

Run from the repository, OpenKumi keeps apart from an OpenKumi installed on the same computer.
So you can use a release there as anyone does, updating itself as releases come out, while you
work on the next one:

| | Installed | From the repository |
| --- | --- | --- |
| Data | `~/.openkumi` | `~/.openkumi-dev` |
| The first person's server, and its webhooks | ports 4317 and 4318 | ports 4417 and 4418 |
| The desktop app's own data | `OpenKumi` (on a Mac in `~/Library/Application Support/`) | `OpenKumi Dev`, beside it |
| Background service | `openkumi service install` | none: `npm run server` runs it in a terminal |

`OPENKUMI_HOME` and `OPENKUMI_PORT` choose another folder and port either way, and
`OPENKUMI_DESKTOP_DATA` another folder for the app's own data. A server counts as run from the
repository when the repository's `.git` is there, unless an installed `openkumi` started it.

The background services on the computer are the installed OpenKumi's. They are named after its
people, and the people here often have the same names. So from the repository,
`npm run openkumi -- service …` refuses, and renaming or removing a person leaves services alone.

Before this kept apart, code from the repository ran on `~/.openkumi`, and may have left it in a
data format newer than the latest release reads. That release would then refuse to start on it.
So look before installing one:

```sh
# the format of the data there, one line per database
find ~/.openkumi -maxdepth 3 -name openkumi.db -exec sqlite3 -readonly {} 'PRAGMA user_version' \;
# the format the latest published release reads
git fetch -q --tags origin
git grep -h "export const FORMAT" "$(gh release view --json tagName -q .tagName)" -- apps/server/src
```

If any of the first is higher, stop what runs on `~/.openkumi` and move it out of the way: to
`~/.openkumi-dev`, where the repository goes on using it, or, when that is taken, to any other
name, which `OPENKUMI_HOME` then points a repository run at. The release starts afresh.

Then install the release, as anyone would:

```sh
curl -fsSL https://openkumi.ai/install.sh | sh   # the server, as a background service
```

Then add the desktop app from [openkumi.ai](https://openkumi.ai). It uses that server, and both
update themselves. The installed OpenKumi and the one from the repository still share what is
yours rather than OpenKumi's: the sign-ins of Claude Code and Codex, and your account on the
computer. On an iPhone, a build of the phone app made here takes the place of the one from
TestFlight, since both are the same app to the phone.

What still reaches the installed OpenKumi:

- **An app you package here** (`npm run dist`, `npm run dist:dir`) is an installed app: it uses
  `~/.openkumi` and port 4317, and joins the installed server. Do not drag it into Applications,
  where it would take the released app's place. A newer version can also bring the data up to a
  format the release cannot read yet (`FORMAT`, under [Releasing](#releasing)), and the release
  then refuses to start until a release that reads it is out. Try it with `try.mjs` (under
  [Releasing](#releasing)), which gives it a temporary folder, or open it from `release/` with
  places of its own:

  ```sh
  OPENKUMI_HOME=~/.openkumi-try OPENKUMI_PORT=4517 OPENKUMI_DESKTOP_DATA="$HOME/Library/Application Support/OpenKumi Try" \
    release/mac-arm64/OpenKumi.app/Contents/MacOS/OpenKumi
  ```

  It still looks after services as an installed app does: renaming or removing a person in it
  stops the installed OpenKumi's service of the same name.

- **`OPENKUMI_HOME=~/.openkumi` from the repository** runs this code on the installed
  OpenKumi's data, with the same risk.

## Releasing

One tag releases everything. Nothing else does: not a merge, not a pull request.

```sh
git switch -c release-0.2.0 main
npm run bump 0.2.0                     # gives every part the version, the iPhone app included
git commit -am "Release 0.2.0"
git push -u origin release-0.2.0
gh pr create --fill                    # merge it once the tests pass
git switch main && git pull
git tag v0.2.0                         # on the merged commit
git push origin v0.2.0                 # the tag is what starts the release
```

Nothing reaches `main` but through a pull request, the version too (see
[What GitHub enforces](#what-github-enforces)). The tag has to be `v` and the version the code
says; the release stops at its first step if it is not. What the tag starts is
`.github/workflows/release.yml`, whose jobs are named for what they do and run in this order,
each only when the ones before it passed:

| | Job | What it does |
| --- | --- | --- |
| 1 | Check the version and run the tests | refuses a tag that is not the code's version, or a release without the Mac signing secrets |
| 2 | Server: build the archives | the server as it is installed on its own, for macOS and Linux |
| 2 | Server: install and start on … | installs each archive with `install.sh` on a computer of its kind, and starts it |
| 2 | Desktop app: build for Mac, Windows, Linux | the installers, signed and notarized on a Mac; each is then installed the way people install it, opened and used |
| 2 | Desktop app: open it on Linux ARM | the same for the ARM AppImage, on a computer that can run it |
| 3 | Publish the release: desktop app and server | the GitHub release people download from, and that installed apps and servers update from |
| 4 | Release the iPhone app | over the air, or a build for TestFlight (see [Releasing the iPhone app](mobile-releases.md)) |

If a job fails, nothing after it runs: a failed build publishes nothing, and the iPhone app is
only released once the release is out. Fix it, then either run the failed jobs again from the
run's page, or delete the tag and push it again on the fixed commit.

The other two workflows release nothing: **Tests** runs the tests on every pull request and on
`main`, and **iPhone app: native change check** labels pull requests that change the native
iPhone app. The website is not part of a release: it is published from `main` by its host.

What it builds:

- the desktop app: `OpenKumi-mac-arm64.dmg` (with the `.zip` an installed app
  updates from), `OpenKumi-win-x64.exe`, `OpenKumi-linux-x86_64.AppImage` and
  `OpenKumi-linux-arm64.AppImage`, with the `latest*.yml` files the
  app reads to find them;
- the server: `openkumi-server-<system>-<processor>.tar.gz` for macOS on Apple silicon and
  for Linux on x64 and ARM (`npm run dist:server` makes them here), each installed and started once on a
  computer of its kind before anything is published, and `openkumi-server.json`, which a running
  server reads to find its next version;
- `SHA256SUMS` for every file, and `install.sh`.

Files are named for what they run on and not for their version, so
`…/releases/latest/download/<file>` is always the newest: that is what the website's button, the
installer and both updaters use. A pull request that changes the packaging runs the same builds as
a rehearsal and publishes nothing.

The Mac app has to be signed with a **Developer ID Application** certificate and notarized by
Apple, or macOS will neither open it on another computer nor let it update itself. The workflow
does both with these repository secrets, and refuses to release without them:

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | the certificate with its private key, exported as `.p12`, in base64 |
| `MAC_CERTIFICATE_PASSWORD` | the password of that `.p12` |
| `APPLE_API_KEY_P8` | an App Store Connect team key (the contents of its `.p8` file), for notarizing |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | that key's ID, and the issuer ID shown above the list of keys |

The Windows installer is not signed, so Windows warns before running it the first time.

Before anything is published, every desktop app is used as installed
(`apps/desktop/scripts/try.mjs`): its window, the server it starts, a bot on each kind of engine
and a bot's browser. The engines are the tests' stand-ins, installed as the real ones are (on
Windows as npm's launcher scripts), so the server has to find and start them itself. To run it
here against an app made with `npm run dist:dir`:

```sh
node apps/desktop/scripts/try.mjs release/mac-arm64/OpenKumi.app/Contents/MacOS/OpenKumi --hidden --browser
```

Once people have installed a release, what they keep in `~/.openkumi` has to keep working with
every release after it. The format of that folder has a number, `FORMAT` in
`apps/server/src/config.ts`, which is written into each person's database, and into the
database in the folder itself, which is all a version from before people had folders looks at. A version that finds a higher number
than its own was started on data a newer version wrote: it changes nothing, says so, and does not
start. Raise the number with any change an older version cannot work with, and add the step that
brings older data up to it; a new table, or a column older versions can ignore, needs no new
number.

The iPhone app is released by the same tag, once the release is published: over the air when
only its JavaScript changed, through TestFlight and its public beta when its native side did. It
needs the `EXPO_TOKEN` secret; without it everything else is still released. See
[Releasing the iPhone app](mobile-releases.md).

## What GitHub enforces

Two rulesets guard the repository, under **Settings → Rules → Rulesets**.

**Protect main** (`main`) holds for everyone, the repository's admin and anything working with
the admin's sign-in included:

- a change reaches it only through a pull request; none is pushed to it directly;
- **Tests** ("Run the tests") has to pass on the pull request first. When it fails for a reason
  that is not the change, run the failed job again from the pull request's page;
- every commit is signed, and GitHub shows it as Verified. Merges made on GitHub are signed by
  GitHub. To sign your own, with an SSH key you already have:

  ```sh
  git config --global gpg.format ssh
  git config --global user.signingkey ~/.ssh/id_ed25519.pub
  git config --global commit.gpgsign true
  ```

  and add the same key on GitHub (**Settings → SSH and GPG keys**) as a *Signing key*;
- it cannot be force-pushed or deleted.

No approval is required, as a pull request's author cannot approve their own. Ask for one when
there is someone else to give it.

**Protect release tags** (`v*`): only an admin can make, move or delete one, so neither a
workflow nor anyone with write access can start or change a release. An admin can still delete
a tag and push it again on a fixed commit, as described above.

Also on, in the repository's security settings: secret scanning, with push protection (a push
with a key or token in it is refused), Dependabot alerts, and private vulnerability reporting.

## Where the code is

```
apps/
  server/            the server: runs the bots. Node, straight from TypeScript, no build step
    src/
      agent.ts         the agent loop, the system prompt and subagent orchestration
      tools.ts         tools the model can call (bots, files, subagents, browser, web)
      bots.ts          bots as folders: bot.md and what sits beside it
      workspace.ts     a bot's own files: path confinement, file operations, git history
      superpowers.ts   the superpowers that ship, which bot has which, and what a bot is told of them
      mcp.ts           the services superpowers bring: each bot's connection and sign-in
      browser.ts       one persistent Chrome profile per bot, a window per thread; live view via CDP screencast
      providers/       what bots run on: the Codex and Claude Code engines (codex.ts,
                       claude-code.ts, grok.ts), local models, OpenAI-compatible APIs, a mock for tests
      tool-endpoint.ts serves a bot's tools to an engine over MCP for the length of one turn
      calls.ts         calls: sets one up through Codex, passes what the voice hands over to the bot,
                       and has the voice say what the bot answers
      config.ts        where the data is, whose server this one is (`--for <name>`), and the data's FORMAT
      people.ts        the people with bots on this computer: adding, renaming, removing them
      start.ts         `openkumi start`: everyone's servers in one terminal, each started again after an update
      service.ts       the background service of a server installed alone, one per person
      update.ts        a server installed alone updating itself, safely for several on one program
      settings.ts      app-wide settings, kept in settings.json
      http.ts          the API and the stream of events. No pages
      history.ts       what a model is shown of a long conversation: trimming, and the summary of its older part
      db.ts            SQLite (conversations and messages)
    superpowers/       the superpowers that ship with OpenKumi
  web/               the interface (React, Vite). Built into the desktop app; nothing serves it
    src/
      store.ts               the window's copy of the environment it shows
      connection.worker.ts   the connection to the environment, on a thread of its own
  desktop/           the desktop app (Electron)
    src/
      main.ts          the window, the menu, and what the window may ask for
      local.ts         the local environment: the server, in a process of its own, and the
                       servers of the other people on this computer
      people.ts        Settings → Environments → People on this computer, through `openkumi people`
      environments.ts  the list of environments and their access codes
      protocol.ts      hands the interface to the window under the app's own address
      preload.ts       the bridge between the window and the app
      dictation.ts     runs the Mac's dictation program and passes what it hears to the window
  mobile/            the iPhone app (Expo, React Native): pairing, each bot's conversation, calls, a bot's
                     browser, settings and automations. `modules/call-audio` is its one native module
                     of its own (Swift): where a call's sound comes out
  marketing/         the website at openkumi.ai (Astro, built to static pages), and the script that
                     draws every app's icon from the mascot (`npm run icons -w @openkumi/marketing`)
  docs/              the documentation at docs.openkumi.ai (Astro with Starlight, built to static
                     pages); its pages are the Markdown files in `src/content/docs`, and its
                     diagrams are drawn at build time from `src/components/diagram` (see below)
packages/
  shared/            the types every app agrees on
  client/            what every app needs to talk to a server: the connection, the state
                     kept from it, pairing. Used by the desktop window and the phone app
  dictation/         dictation on the device (Swift, Apple's speech models): one engine, run by the
                     desktop app as a small program on a Mac and built into the phone app as an Expo module
```

## Diagrams in the documentation

The diagrams on docs.openkumi.ai are plain SVG drawn when the site is built, so they need nothing
in the reader's browser and follow its light and dark colours. They are made of a few components
in `apps/docs/src/components/diagram`:

- `Figure` holds a diagram and its caption; inside it go `Box` (a part, with a `kind`: `ours`,
  `plain`, `outside`, `secret` or `danger`), `Zone` (a dashed area round boxes), `Arrow` (a line
  through any corners, with a label; `both`, `dashed`, `blocked`) and `Note` or `Lines` (loose
  words).
- `Sequence` lays out a sequence diagram from a list of actors and steps, so a page only says what
  happens: `{ from, to, text }`, `{ note, over }` and `{ section }`.

The diagrams used on more than one page are in `apps/docs/src/components/diagrams`; sequence
diagrams are written in the page itself. Diagrams are drawn 680 units wide, about the width of the
text, and scroll sideways on a narrow screen. Words in SVG do not wrap: the build prints a
`[diagram]` warning when a line is wider than its box.

## Trying a call without a microphone

A call needs the real Codex, signed in with a ChatGPT plan; the tests use a stand-in for it
(`apps/server/test/fixtures/fake-codex.mjs`), which plays the voice from a script. To hear the
real thing on a computer with no microphone, start the built app with Chromium's made-up one,
which "says" a recording (a WAV file) from the moment the call starts:

```sh
cd apps/desktop
npx electron . --use-fake-device-for-media-stream \
  --use-file-for-fake-audio-capture=/path/to/question.wav \
  --disable-features=AudioServiceSandbox,AudioServiceOutOfProcess
```

Without the last switch the recording is not read, and the microphone is silent. With a made-up
microphone the app does not ask the system whether it may listen. `say -o question.wav
--data-format=LEI16@48000 "What is on my calendar tomorrow?"` makes a recording on a Mac; a few
seconds of silence in front of it give the call time to connect.

## Adding a model provider


Implement the `Provider` interface in `apps/server/src/providers/types.ts` and register it in
`apps/server/src/providers/index.ts`. A provider has `info` and `models`, and either `stream` (answer one
model request; OpenKumi runs the tools) or `turn` (run a whole turn, as the engines do). The agent
loop only deals in the neutral item types from `packages/shared/src/types.ts`; each provider converts those to
and from its own format.
