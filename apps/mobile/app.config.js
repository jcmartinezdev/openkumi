// The app's settings are in app.json. This adds the two things that depend on where it is built.
//
// A build made by EAS (the ones that go to TestFlight and the App Store) is told by EAS which
// channel of updates it listens to. A build made on a computer has no channel, so it keeps the
// JavaScript it was built with: what is sent to a phone from here is not replaced by what was
// last published. To try updates with such a build, name the channel when it is made:
//   OPENKUMI_UPDATE_CHANNEL=verify npx expo prebuild
//
// The app can show in a car, through CarPlay (modules/car). Apple gives an app the right to on
// request, and a build for a phone cannot be signed without it, so it is left out of the app
// unless asked for (the simulator does not check for the right):
//   OPENKUMI_CAR=1 npx expo prebuild
module.exports = ({ config }) => {
  const channel = process.env.OPENKUMI_UPDATE_CHANNEL
  if (channel) config = { ...config, updates: { ...config.updates, requestHeaders: { 'expo-channel-name': channel } } }
  if (process.env.OPENKUMI_CAR === '1') config = { ...config, plugins: [...(config.plugins ?? []), './modules/car/plugin'] }
  return config
}
