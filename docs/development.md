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

A release is made with one button: on GitHub, **Actions → Release → Run workflow**, on `main`,
with the version to release (`0.2.0`). There is no other way to release, and nothing to do on your
own computer.

That one run (`.github/workflows/release.yml`):

1. gives every part the version (`npm run bump`, the iPhone app included) and tests it;
2. commits the version to `main` as "Release 0.2.0";
3. builds everything from that commit, on computers of each kind;
4. publishes the release, which also puts the tag `v0.2.0` on that commit;
5. releases the iPhone app from the same code (see [Releasing the iPhone app](mobile-releases.md)).

If a build fails, nothing is published: fix it and run the same version again.

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

Once people have installed a release, what they keep in `~/.openkumi` has to keep working with
every release after it.

The iPhone app is released by the same run, once the release is published: over the air when
only its JavaScript changed, through TestFlight when its native side did. It needs the
`EXPO_TOKEN` secret; without it everything else is still released. See
[Releasing the iPhone app](mobile-releases.md).
