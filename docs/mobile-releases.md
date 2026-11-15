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

## What happens when a change is merged

`.github/workflows/mobile-release.yml` runs for every change merged into `main` that touches the
app or what it is built from:

| The fingerprint | What happens |
| --- | --- |
| has a finished build | the JavaScript is published to the `production` channel, and the phones with that build fetch it |
| has a build still being made | nothing; updates carry on with the next change merged after it is done |
| has a build that failed | the run fails, saying so; start the build again by hand |
| has no build | a build is started and sent to TestFlight |

Run by hand (**Actions → Mobile release → Run workflow**) it does one or the other whatever the
fingerprint says: `update` to send the JavaScript out again, `build` to make a build.

## Before a change is merged

`.github/workflows/mobile-fingerprint.yml` runs on every pull request and compares the fingerprint
with and without the change. Its summary says which packages or settings moved it, and a pull
request that changes it gets the label **📱 Native change**.

That label matters because of what comes after: once a native change is merged, nothing merged
after it reaches the phones until the new build is out. So hold pull requests with the label, and
merge them together when a new build is due.

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

The app and a server do not have to be the same version (see [Installing and
updating](install.md#updates)): the app says so when one of them is too old for the other. With
updates over the air, a change that needs both can reach the phones the same day as the server.

The version in `app.json` is the one the App Store shows. Raise it when a build is a new release
for the store; the build number beside it is counted up by EAS for every build.

## Setting it up, once

The project on Expo exists: [`@gotolcs/openkumi`](https://expo.dev/accounts/gotolcs/projects/openkumi).
What is left needs someone who can sign in to Expo and to Apple:

1. **A token for GitHub.** On expo.dev, under the account's **Access tokens**, make one (a robot
   user's, for an organisation) and save it as the repository secret `EXPO_TOKEN`. Without it the
   workflow does nothing.
2. **The app at Apple.** Register the identifier `ai.openkumi.mobile` (developer.apple.com →
   Identifiers) and add the app in App Store Connect (**Apps → +**). Put the number App Store
   Connect gives it (**App Information → Apple ID**) into `apps/mobile/eas.json`:
   `"submit": { "production": { "ios": { "ascAppId": "…" } } }`.
3. **Apple's keys, kept by EAS.** In `apps/mobile`, run `npx eas-cli credentials` and let it make
   the distribution certificate and profile, and take an App Store Connect key for sending builds
   to TestFlight. The key has to be a team key with the App Manager role or above.
4. **The first build.** Actions → Mobile release → Run workflow → `build`. It arrives in
   TestFlight, where your own team can install it at once; testers outside the team, and the App
   Store, wait for Apple's review.

From then on, merging is releasing.
