// The app's side of what a car shows (Car.swift): the app hands over the whole screen each time it
// changes, and hears what was tapped there.
import ExpoModulesCore

public class CarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenKumiCar")

    // onConnected { connected }: a car's screen is there, or gone.
    // onPick { id }: a row of the list was tapped.
    // onAction { id: "hangUp" | "mute" | "unmute" | "dismiss", of }: a button of the call or of the alert `of` was.
    // onAction { id: "noScreen", of }: the car would not show the screen of the call with `of`.
    Events("onConnected", "onPick", "onAction")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        MainActor.assumeIsolated {
          Car.shared.tell = { event, body in self?.sendEvent(event, body) }
        }
      }
    }

    // What follows runs on the main queue, where everything of the car's screen is done.
    AsyncFunction("connected") { () -> Bool in
      MainActor.assumeIsolated { Car.shared.connected }
    }.runOnQueue(.main)

    AsyncFunction("show") { (screen: CarScreen) in
      MainActor.assumeIsolated { Car.shared.show(screen) }
    }.runOnQueue(.main)

    // A picture for rows and calls to name: a PNG, in base64.
    AsyncFunction("keep") { (name: String, png: String) in
      MainActor.assumeIsolated { Car.shared.keep(name, png: png) }
    }.runOnQueue(.main)
  }
}
