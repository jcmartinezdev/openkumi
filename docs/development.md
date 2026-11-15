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
```

The tests are run with Node.js 26 (`node --test test/` needs it). They use a scripted offline model, a real headless Chrome for the bots, and the real app
with its window kept off the screen. Everything they touch is temporary. To test a packaged app
instead of the source: `OPENKUMI_DESKTOP_APP="release/mac-arm64/OpenKumi.app/Contents/MacOS/OpenKumi" npm test -w @openkumi/desktop`.

## Releasing

A release is made by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed:

```sh
npm run bump 0.2.0       # gives every part the new version, the iPhone app included
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push --follow-tags
```

It runs the tests, then builds, on computers of each kind:

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
does both when these repository secrets are set, and otherwise leaves the release as a draft:

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | the certificate with its private key, exported as `.p12`, in base64 |
| `MAC_CERTIFICATE_PASSWORD` | the password of that `.p12` |
| `APPLE_API_KEY_P8` | an App Store Connect team key (the contents of its `.p8` file), for notarizing |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | that key's ID, and the issuer ID shown above the list of keys |

The Windows installer is not signed, so Windows warns before running it the first time.

Once people have installed a release, what they keep in `~/.openkumi` has to keep working with
every release after it.

The iPhone app is released by the same tag, once the release is published: over the air when
only its JavaScript changed, through TestFlight when its native side did. See
[Releasing the iPhone app](mobile-releases.md).
