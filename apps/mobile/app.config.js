// The app's settings are in app.json. This adds what depends on where it is built.
//
// A build made by EAS (the ones that go to TestFlight and the App Store) is told by EAS which
// channel of updates it listens to. A build made on a computer has no channel, so it keeps the
// JavaScript it was built with: what is sent to a phone from here is not replaced by what was
// last published. To try updates with such a build, name the channel when it is made:
//   OPENKUMI_UPDATE_CHANNEL=verify npx expo prebuild
module.exports = ({ config }) => {
  const channel = process.env.OPENKUMI_UPDATE_CHANNEL
  if (channel) config = { ...config, updates: { ...config.updates, requestHeaders: { 'expo-channel-name': channel } } }
  return config
}
