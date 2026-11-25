// Puts the app on a car's screen: names the screen it has there (apple/CarSceneDelegate.swift) in
// the app's Info.plist, and asks for the right to be in CarPlay as an app that is talked with.
//
// Apple gives that right to an app on request. A build signed for a phone fails without it, so this
// is only added to the app where app.config.js is told to (OPENKUMI_CAR=1).
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins')

module.exports = function withCar(config) {
  config = withEntitlementsPlist(config, (given) => {
    given.modResults['com.apple.developer.carplay-voice-based-conversation'] = true
    return given
  })
  return withInfoPlist(config, (given) => {
    const manifest = (given.modResults.UIApplicationSceneManifest ??= {})
    // The phone's screen and the car's are there at the same time: Apple wants that said.
    manifest.UIApplicationSupportsMultipleScenes = true
    const scenes = (manifest.UISceneConfigurations ??= {})
    scenes.CPTemplateApplicationSceneSessionRoleApplication = [
      { UISceneClassName: 'CPTemplateApplicationScene', UISceneConfigurationName: 'Car', UISceneDelegateClassName: 'OpenKumiCarSceneDelegate' },
    ]
    return given
  })
}
