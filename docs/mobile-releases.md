# Releasing the iPhone app

Apple reviews every build that goes through the App Store, which can take a day or more. Most
changes to the app do not need to wait for that: the app is native code with JavaScript on top,
and nearly everything we change is the JavaScript. So there are two ways a change reaches a phone.

- **Over the air.** The JavaScript is published with [EAS Update](https://docs.expo.dev/eas-update/introduction/),
  and the app that is already installed fetches it and runs it from its next start. This takes
  minutes and involves no review. Apple allows it as long as the app stays the app it was.
- **A build.** A change to the native side (a new native package, a new version of Expo, a new
  permission, the icon) needs a new app, built and sent to TestFlight, and from there to the App
  Store when you choose.

Which of the two a change needs is not left to anyone's judgment. The app has a **fingerprint**: a
hash of everything native about it (its native packages and their versions, the settings in
`app.json`, the dictation module in `packages/dictation`). A build remembers the fingerprint it was
made with, and an update over the air is only offered to builds with the same one. It cannot land
on an app it does not fit.

## What happens at a release

The app is released with everything else, not on its own: it has to work with the servers people
can actually install, and a release is when those change. The last job a release tag starts
("Release the iPhone app" in `.github/workflows/release.yml`, see
[Working on OpenKumi](development.md#releasing)) is the app, from the code that was tagged:

| The fingerprint | What happens |
| --- | --- |
| has a finished build | the JavaScript is published to the `production` channel, and the phones with that build fetch it |
| has a build still being made | nothing; send the update by hand once the build is done (below) |
| has no build, or one that failed | a build is started and sent to TestFlight |

So a release that only changes the app's JavaScript is on the phones minutes after the desktop
app and the server are out. One that changes the native app goes through TestFlight, and to the
people who have it from the App Store once Apple has reviewed it. In the meantime their app keeps
working with the new server, unless the release changed how the two talk
(`packages/shared/src/protocol.ts`): then the app says it needs the update.

By hand, from `apps/mobile` on a computer signed in to Expo (`npx eas-cli login`), with the
released code checked out:

```sh
npx eas-cli update --channel production --environment production --platform ios   # send the JavaScript over the air
npx eas-cli build --platform ios --profile production --auto-submit                # make a build and send it to TestFlight
```

## Before a change is merged

`.github/workflows/iphone-native-change.yml` runs on every pull request and compares the fingerprint
with and without the change. Its summary says which packages or settings moved it, and a pull
request that changes it gets the label **📱 Native change**.

The label says what the change costs: the release it is part of cannot reach the phones over the
air, and goes through TestFlight and Apple's review. Several such changes are best put into the
same release.

## In the app

- The app asks for an update when it starts, and again when it comes back after fifteen minutes
  or more in the background. What it finds is downloaded quietly and used from the next start.
- Back after half an hour or more with an update waiting, the app starts it at once.
- **Settings → About** says when the last update was published, and has **Check for updates** and,
  once one is downloaded, **Restart to update**.
- A build made on a computer (`npm run mobile`, or one sent to a phone from Xcode) listens to no
  channel, so it keeps the JavaScript it was built with. To try updates with such a build, name a
  channel when it is made: `OPENKUMI_UPDATE_CHANNEL=verify npx expo prebuild`, then publish to it
  with `OPENKUMI_UPDATE_CHANNEL=verify npx eas-cli update --channel verify --environment production`
  (the channel is part of such a build's fingerprint, so it has to be named for both).

The code is in `apps/mobile/src/appUpdates.ts`; the settings are `runtimeVersion` and `updates` in
`apps/mobile/app.json`, and the build profile in `apps/mobile/eas.json`.

## Versions

The app has the version of the release it came with: `npm run bump` sets it in
`apps/mobile/app.json` with the rest, and a release is refused when they differ.
The version is not part of the fingerprint, so a new one alone does not ask for a build; the
build number beside it is counted up by EAS for every build.

The dictation package (`packages/dictation`) is left out of `npm run bump` on purpose. It is
native code, its version is part of the fingerprint, and raising it with every release would
send every release through TestFlight.

## Setting it up, once

The project on Expo exists: [`@gotolcs/openkumi`](https://expo.dev/accounts/gotolcs/projects/openkumi).
What is left needs someone who can sign in to Expo and to Apple:

1. **A token for GitHub.** On expo.dev, under the account's **Access tokens**, make one (a robot
   user's, for an organisation) and save it as the repository secret `EXPO_TOKEN`. Without it a
   release leaves the iPhone app out.
2. **The app at Apple.** Register the identifier `ai.openkumi.mobile` (developer.apple.com →
   Identifiers) and add the app in App Store Connect (**Apps → +**). Put the number App Store
   Connect gives it (**App Information → Apple ID**) into `apps/mobile/eas.json`:
   `"submit": { "production": { "ios": { "ascAppId": "…" } } }`.
3. **Apple's keys, kept by EAS.** In `apps/mobile`, run `npx eas-cli credentials` and let it make
   the distribution certificate and profile, and take an App Store Connect key for sending builds
   to TestFlight. The key has to be a team key with the App Manager role or above.
4. **The first build.** The next release makes it, since no build exists yet (or make it by
   hand, as above). It arrives in TestFlight, where your own team can install it at once; testers
   outside the team, and the App Store, wait for Apple's review.

From then on, a release of OpenKumi releases the app with it.
