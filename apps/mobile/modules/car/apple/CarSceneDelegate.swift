// The app's screen in a car. CarPlay makes one of these when the app is opened on the car's screen
// (it is named in the app's Info.plist, by plugin.js), and tells it when the car is there and gone.
//
// A car can be the only screen the app is on: the phone locked in a pocket, the app not opened
// since the phone was started. The app's own start is tied to its window on the phone, so here it
// is started without one, for the car alone: on a window nobody sees, with a part of the app that
// draws nothing (`car`, in index.js). What the app does without its window (the connection to the
// computer, the calls) runs all the same, and the window gets its own start when the phone is
// looked at.
import CarPlay
import Expo
import React
import UIKit

@objc(OpenKumiCarSceneDelegate)
public class CarSceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  public func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
    startTheApp()
    Car.shared.inFront = true
    Car.shared.connect(interfaceController)
  }

  public func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
    Car.shared.disconnect()
  }

  public func sceneDidBecomeActive(_ scene: UIScene) {
    Car.shared.inFront = true
  }

  public func sceneWillResignActive(_ scene: UIScene) {
    Car.shared.inFront = false
  }

  /// Starts React Native when the phone's window has not: it does, or will, wherever there is one.
  private func startTheApp() {
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider, provider.window == nil, let factory = provider.reactNativeFactory else { return }
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    provider.window = window
    factory.startReactNative(withModuleName: "car", in: window, launchOptions: nil)
  }
}
