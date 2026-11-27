# Releasing the iPhone app

Apple reviews every build that goes through the App Store, which can take a day or more. Most
changes to the app do not need to wait for that: the app is native code with JavaScript on top,
and nearly everything we change is the JavaScript. So there are two ways a change reaches a phone.

- **Over the air.** The JavaScript is published with [EAS Update](https://docs.expo.dev/eas-update/introduction/),
  and the app that is already installed fetches it and runs it from its next start. This takes
  minutes and involves no review. Apple allows it as long as the app stays the app it was.
- **A build.** A change to the native side (a new native package, a new version of Expo, a new
  permission, the icon) needs a new app, built and sent to TestFlight, where people get it once
  Apple's beta review has passed it.

Which of the two a change needs is not left to anyone's judgment. The app has a **fingerprint**: a
hash of everything native about it (its native packages and their versions, the settings in
`app.json`, the dictation module in `packages/dictation`, the call sound module in
`apps/mobile/modules/call-audio`, the car's screen in `apps/mobile/modules/car`). A build remembers the fingerprint it was
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
| has a finished build, 75 days old or more | the same, and a new build is made too (below, "The public beta") |
| has a build still being made | nothing; send the update by hand once the build is done (below) |
| has no build, or one that failed | a build is started, sent to TestFlight, and handed to the public beta |

So a release that only changes the app's JavaScript is on the phones minutes after the desktop
app and the server are out. One that changes the native app goes through TestFlight: the team
has it as soon as Apple has processed it, and the public beta once Apple's beta review has passed
it, usually within a day. In the meantime their app keeps working with the new server, unless the
release changed how the two talk (`packages/shared/src/protocol.ts`): then the app says it needs
the update.

By hand, from `apps/mobile` on a computer signed in to Expo (`npx eas-cli login`), with the
released code checked out:

```sh
npx eas-cli update --channel production --environment production --platform ios   # send the JavaScript over the air
npx eas-cli build --platform ios --profile production --auto-submit                # make a build and send it to TestFlight
node scripts/testflight.mjs send 0.0.3 --wait 60                                   # hand it to the public beta, once it is there
```

## The public beta

The app is not in the App Store. Apple keeps betas out of it (guideline 2.2), and the app says it
is an alpha. People get it through TestFlight instead, from the public link of the group
**Public beta**: <https://testflight.apple.com/join/dvcBQvNu>. Up to 10,000 people can join, and
they send feedback with a screenshot from the TestFlight app.

A build reaches that group only after two steps, which `apps/mobile/scripts/testflight.mjs` takes
(Expo's own submit can only reach the team's group):

1. `send <version>` waits until Apple has processed the version's build, writes what to test (a
   link to the release's notes), adds it to the group, and sends it to Apple's beta review. The
   testers are told once the review has passed it. The first build of each version is reviewed,
   usually within a day; a later build of a version Apple has seen may be passed without one. A
   release does this by itself for each build it makes. `--hold` does all but send it to the
   review, to try the build on your own phone first.
2. `texts` sends what testers and the reviewer read: `apps/mobile/testflight/description.txt` and
   `review-notes.txt`, with the website and the privacy policy. Apple wants the feedback address
   and the reviewer's contact beside them, and those come from the environment
   (`TESTFLIGHT_FEEDBACK_EMAIL`, `TESTFLIGHT_CONTACT_FIRST_NAME`, `_LAST_NAME`, `_EMAIL`, `_PHONE`),
   since a phone number does not belong here. Run it when those words change. The feedback
   address is support@gotolcs.com, and the reviewer's contact is the one goto LCS's other apps
   give Apple.

Both sign in with the App Store Connect key in `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID` and
`EXPO_ASC_ISSUER_ID`, as the release does.

TestFlight stops opening a build 90 days after it was uploaded, and an update over the air does
not change that. So when the newest build is 75 days old, the next release makes a new one, with
the same native app, and hands it to the group too. Without a release in those last two weeks
the testers' app stops opening until there is one.

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

## In a car

The app shows in a car, through CarPlay: the bots as a list, and a tap on one calls it, with the
car's microphone and loudspeakers. It is in every build since Apple allowed it on 2026-11-27.

- **Apple's permission.** An app is only let into CarPlay with an entitlement Apple gives on
  request, and a build for a phone cannot be signed while the app asks for one its profile does not
  carry. The account holder asked at <https://developer.apple.com/contact/carplay/>, for the
  category **voice-based conversational app** (in CarPlay since iOS 26.4; the entitlement is
  `com.apple.developer.carplay-voice-based-conversation`). The rules for that category are in
  Apple's [CarPlay Developer Guide](https://developer.apple.com/download/files/CarPlay-Developer-Guide.pdf):
  the app is talked with, holds the car's sound only during a call, shows the screen for a voice
  while one is on, and does not answer with text or pictures.
- **Where it is switched on.** The identifier `ai.openkumi.mobile` has the capability (Certificates,
  Identifiers & Profiles › Identifiers › its Capability Requests tab; only the account holder or an
  Admin sees it there, and the App Store Connect API cannot set it). The provisioning profile on
  EAS was made after that, so it carries the entitlement. A profile made anew carries it too, as
  long as the identifier keeps the capability. In the app, `apps/mobile/modules/car/plugin.js`
  (in `plugins` in `app.json`) adds the entitlement, and the car's screen to the app's `Info.plist`,
  which then also says the app has more than one screen at a time. An iPad has no CarPlay and
  would take that to mean the app can be opened in several windows, so it gets the screens as they
  were before the car's (`UIApplicationSceneManifest~ipad`).
- **How it works.** CarPlay draws the screens itself: a list, the screen for a voice, an alert. What
  goes on them is worked out in `packages/client/src/car.ts` (tried by its test, without a car),
  handed over by `apps/mobile/src/car.ts`, and put on the car's screen by `apps/mobile/modules/car`
  (Swift). A car is often the only screen the app is on, the phone locked in a pocket. So the app is
  started without its window then (`CarSceneDelegate.swift`, and `index.js`, which loads the car's
  part before the screens), and the paired server is kept where a locked phone can read it
  (`apps/mobile/src/session.ts`).
- **Trying it.** Xcode 27 shows no CarPlay for a simulated iPhone. A real one can be tried on a
  cable with CarPlay Simulator in Xcode's Device Hub (Device → CarPlay Simulator), or in a car.
  What the car would show can also be read from the test of `packages/client/src/car.ts`.

Still to do on a real car's screen: look at the list and the call's screen (its two buttons, Mute
and End, need iOS 26.4), hear a call through the car, check that music or radio comes back when
the call ends, that the call goes on while a map is looked at, and that the app opens in the car
with the phone locked.

## Versions

The app has the version of the release it came with: `npm run bump` sets it in
`apps/mobile/app.json` with the rest, and a release is refused when they differ.
The version is not part of the fingerprint, so a new one alone does not ask for a build; the
build number beside it is counted up by EAS for every build.

The dictation package (`packages/dictation`) is left out of `npm run bump` on purpose. It is
native code, its version is part of the fingerprint, and raising it with every release would
send every release through TestFlight.

## What it runs on

Everything is set up; this is where it is, for when something has to be renewed or looked at.

- **Expo:** the project [`@goto-lcs-ug/openkumi`](https://expo.dev/accounts/goto-lcs-ug/projects/openkumi)
  holds the updates, the builds, and the signing credentials for building (an Apple Distribution
  certificate and an App Store provisioning profile, which Expo made with the Apple key).
  `npx eas-cli credentials -p ios` shows and renews them.
- **Apple:** the identifier `ai.openkumi.mobile` and the app "OpenKumi" in App Store Connect. Its
  number is in `apps/mobile/eas.json` (`ascAppId`); builds sent to TestFlight land there. Its
  TestFlight groups are **Team (Expo)**, which gets every build, for the team, and **Public beta**,
  with the public link.
- **GitHub secrets:** `EXPO_TOKEN` (an access token of the Expo user `jarvisaimini`, limited to
  the organisation `goto-lcs-ug` with the Release Manager role; without it a release leaves the
  iPhone app out), and the App Store Connect key the Mac app is notarized with
  (`APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), which also sends builds to
  TestFlight.

A build arrives in TestFlight, where the team can install it at once; the public beta waits for
Apple's beta review.

To try that the app still builds on Expo's computers without releasing anything:
`npx eas-cli build --platform ios --profile simulator` makes one for the simulator only.
