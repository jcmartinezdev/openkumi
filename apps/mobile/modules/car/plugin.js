// Puts the app on a car's screen: names the screen it has there (apple/CarSceneDelegate.swift) in
// the app's Info.plist, and asks for the right to be in CarPlay as an app that is talked with.
//
// Apple gives that right to an app on request, and has given it to this one: the app identifier
// ai.openkumi.mobile has the capability, and the provisioning profile carries it. A build for a
// phone signed with a profile made before that fails (docs/mobile-releases.md, "In a car").
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins')

const CAR = 'CPTemplateApplicationSceneSessionRoleApplication'

module.exports = function withCar(config) {
  config = withEntitlementsPlist(config, (given) => {
    given.modResults['com.apple.developer.carplay-voice-based-conversation'] = true
    return given
  })
  return withInfoPlist(config, (given) => {
    const plist = given.modResults
    const manifest = (plist.UIApplicationSceneManifest ??= {})
    // An iPad has no CarPlay, and an app that says it has more than one screen at a time can be
    // opened there in several windows, which this app is not made for. So an iPad reads the
    // screens as they were before the car's (a key ending in ~ipad stands in for the one without
    // there), and only an iPhone gets the car's. Made the same on a prebuild over a project that
    // already has the car's screen.
    const ipad = structuredClone({ ...manifest, UIApplicationSupportsMultipleScenes: false })
    delete ipad.UISceneConfigurations?.[CAR]
    plist['UIApplicationSceneManifest~ipad'] = ipad
    // The phone's screen and the car's are there at the same time: Apple wants that said.
    manifest.UIApplicationSupportsMultipleScenes = true
    const scenes = (manifest.UISceneConfigurations ??= {})
    scenes[CAR] = [{ UISceneClassName: 'CPTemplateApplicationScene', UISceneConfigurationName: 'Car', UISceneDelegateClassName: 'OpenKumiCarSceneDelegate' }]
    return given
  })
}
