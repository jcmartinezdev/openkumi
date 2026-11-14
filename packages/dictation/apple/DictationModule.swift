// The iPhone app's dictation, as an Expo module (packages/dictation/src/index.ts is its other side).
// What is said is written down on the phone (Dictation.swift); only the words go to the app.
import ExpoModulesCore

public class DictationModule: Module {
  /// The dictation under way. It is a `Dictation`, which needs iOS 26.
  private var current: AnyObject?

  public func definition() -> ModuleDefinition {
    Name("OpenKumiDictation")
    Events("onDictation")

    Function("isAvailable") { () -> Bool in
      if #available(iOS 26, *) { return true }
      return false
    }

    /// Starts listening, ending any dictation that was under way. What it says comes as `onDictation` events.
    AsyncFunction("start") { (locale: String?) async in
      guard #available(iOS 26, *) else {
        return self.sendEvent("onDictation", DictationEvent.failed(code: "unavailable", message: "Dictation needs iOS 26 or later.").fields)
      }
      await (self.current as? Dictation)?.cancel()
      let dictation = await self.makeDictation()
      self.current = dictation
      await dictation.start(locale: locale)
    }

    AsyncFunction("stop") { () async in
      if #available(iOS 26, *) { await (self.current as? Dictation)?.stop() }
    }

    AsyncFunction("cancel") { () async in
      if #available(iOS 26, *) { await (self.current as? Dictation)?.cancel() }
    }

    OnDestroy {
      if #available(iOS 26, *), let dictation = self.current as? Dictation {
        Task { await dictation.cancel() }
      }
    }
  }

  /// A dictation that tells the app what it hears, for as long as the module is there to.
  @available(iOS 26, *)
  private func makeDictation() async -> Dictation {
    await Dictation { [weak self] event in self?.sendEvent("onDictation", event.fields) }
  }
}
