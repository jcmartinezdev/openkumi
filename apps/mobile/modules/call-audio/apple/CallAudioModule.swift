// Where the sound of a call comes out on an iPhone. The connection itself (react-native-webrtc)
// opens the phone's sound the way a phone call does, which puts the other side's voice in the small
// speaker at the ear. A call with a bot is held in the hand or lies on the table, so here it is put
// on the loudspeaker, unless the owner chose the ear, and left alone when headphones, a car or a
// hearing aid are connected: then the sound is where the owner put it.
//
// The system forgets the choice whenever the way out changes or the connection sets the sound up
// again, so it is made again each time that happens for as long as the call lasts.
import AVFoundation
import ExpoModulesCore
import UIKit

public class CallAudioModule: Module {
  /// A call is on.
  private var on = false
  /// The owner wants the loudspeaker rather than the ear.
  private var loud = true
  private var watch: NSObjectProtocol?
  /// What is kept here is read from the app's thread and from the one the system reports on.
  private let queue = DispatchQueue(label: "ai.openkumi.call-audio")

  public func definition() -> ModuleDefinition {
    Name("OpenKumiCallAudio")

    // { other: the sound goes somewhere that is neither the loudspeaker nor the ear, name: what that is called }
    Events("onRoute")

    Function("start") { (loud: Bool) in
      self.queue.async {
        self.loud = loud
        self.on = true
        if self.watch == nil {
          self.watch = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { self?.apply() }
          }
        }
        self.apply()
      }
    }

    Function("setLoud") { (loud: Bool) in
      self.queue.async {
        self.loud = loud
        self.apply()
      }
    }

    Function("stop") {
      self.queue.async { self.stop() }
    }

    OnDestroy {
      self.queue.async { self.stop() }
    }
  }

  private func apply() {
    guard on else { return }
    let session = AVAudioSession.sharedInstance()
    let outputs = session.currentRoute.outputs
    let ear = outputs.contains { $0.portType == .builtInReceiver }
    let speaker = outputs.contains { $0.portType == .builtInSpeaker }
    let other = !outputs.isEmpty && !ear && !speaker
    // Only a session that also listens can be sent to one or the other; until the connection has
    // opened it there is nothing to do, and the system says so when it has.
    if session.category == .playAndRecord {
      // Each is only asked for when the sound is at the other: asking changes the way out, which is reported here again.
      if loud && ear {
        try? session.overrideOutputAudioPort(.speaker)
      } else if !loud && speaker {
        try? session.overrideOutputAudioPort(.none)
      }
    }
    // At the ear the screen goes dark, as on a phone call, so that a cheek presses nothing.
    let atEar = !loud && !other
    DispatchQueue.main.async { UIDevice.current.isProximityMonitoringEnabled = atEar }
    sendEvent("onRoute", ["other": other, "name": other ? (outputs.first?.portName ?? "") : ""])
  }

  private func stop() {
    guard on else { return }
    on = false
    if let watch = watch { NotificationCenter.default.removeObserver(watch) }
    watch = nil
    DispatchQueue.main.async { UIDevice.current.isProximityMonitoringEnabled = false }
    let session = AVAudioSession.sharedInstance()
    if session.category == .playAndRecord { try? session.overrideOutputAudioPort(.none) }
  }
}
