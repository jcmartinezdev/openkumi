// Dictation: listens to the microphone and writes down what is said, on the device itself, with
// Apple's own speech models (iOS 26 and macOS 26 or later). No sound leaves the device: the words go
// to whoever started the dictation, and they decide where the words go next.
//
// Shared by the iPhone app (DictationModule.swift, an Expo module) and the desktop app's small
// program (../macos/main.swift).
import AVFoundation
import Speech

/// What a dictation says while it runs. The apps get the same thing as `fields`.
enum DictationEvent {
  /// Fetching the speech model for the language, which happens the first time only. `progress` is 0–1.
  case preparing(progress: Double)
  /// The microphone is on, listening for this language.
  case listening(locale: String)
  /// How loud it is, from 0 to 1, about fifteen times a second.
  case level(Float)
  /// What has been said: the part that is settled, and the latest guess at what came after it.
  case text(settled: String, guess: String)
  /// It is over, and this is everything that was said.
  case done(text: String)
  case failed(code: String, message: String)

  var fields: [String: Any] {
    switch self {
    case .preparing(let progress): return ["type": "preparing", "progress": progress]
    case .listening(let locale): return ["type": "listening", "locale": locale]
    case .level(let level): return ["type": "level", "level": level]
    case .text(let settled, let guess): return ["type": "text", "settled": settled, "guess": guess]
    case .done(let text): return ["type": "done", "text": text]
    case .failed(let code, let message): return ["type": "failed", "code": code, "message": message]
    }
  }
}

/// A reason a dictation could not go on, with a code the apps can act on.
struct DictationFailure: Error {
  let code: String
  let message: String
}

@available(iOS 26, macOS 26, *)
@MainActor
final class Dictation {
  private nonisolated let send: @Sendable (DictationEvent) -> Void
  private let engine = AVAudioEngine()
  private var input: AsyncStream<AnalyzerInput>.Continuation?
  private var analyzer: SpeechAnalyzer?
  /// The analyzer starting, which has to be over before it can be told to finish.
  private var starting: Task<Void, Error>?
  private var reading: Task<Void, Never>?
  private var settled = ""
  private var guess = ""
  /// Stopped, given up or failed: nothing more is listened to or said.
  private var over = false
  private var watching: [NSObjectProtocol] = []

  init(send: @escaping @Sendable (DictationEvent) -> Void) {
    self.send = send
  }

  /// Starts listening for `locale` (a language tag like "en-US"), or else for the first of the
  /// person's own languages a model knows. A `recording` is heard instead of the microphone (for tests).
  func start(locale: String?, recording: URL? = nil) async {
    do {
      try await begin(locale, recording)
    } catch {
      fail(error)
    }
  }

  /// Stops listening. What is still being worked out is settled first, then `done` says all that was said.
  func stop() async {
    guard !over else { return }
    over = true
    endListening()
    if let analyzer, let starting {
      do {
        try await starting.value
        try await analyzer.finalizeAndFinishThroughEndOfInput()
      } catch {
        await analyzer.cancelAndFinishNow()
      }
      await reading?.value
    }
    send(.done(text: (settled + guess).trimmingCharacters(in: .whitespacesAndNewlines)))
  }

  /// Gives up: nothing more is said, not even what was heard last.
  func cancel() async {
    guard !over else { return }
    over = true
    endListening()
    reading?.cancel()
    await analyzer?.cancelAndFinishNow()
  }

  private func begin(_ wanted: String?, _ recording: URL?) async throws {
    if recording == nil, !(await Self.microphoneAllowed()) {
      throw DictationFailure(code: "denied", message: "OpenKumi is not allowed to use the microphone.")
    }
    let (module, locale) = try await Self.module(for: wanted)
    // The model for the language, the first time it is used.
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
      send(.preparing(progress: 0))
      let send = send
      let progress = request.progress.observe(\.fractionCompleted) { progress, _ in send(.preparing(progress: progress.fractionCompleted)) }
      defer { progress.invalidate() }
      try await request.downloadAndInstall()
    }
    // Stopped while getting ready.
    if over { return }

    let (sequence, input) = AsyncStream<AnalyzerInput>.makeStream()
    self.input = input
    if let recording {
      try await hear(recording, module)
    } else {
      try await listen(module)
    }
    if over { return endListening() }
    send(.listening(locale: locale.identifier(.bcp47)))

    let analyzer = SpeechAnalyzer(modules: [module], options: .init(priority: .userInitiated, modelRetention: .lingering))
    self.analyzer = analyzer
    if let module = module as? SpeechTranscriber {
      reading = read(module.results) { $0.text }
    } else if let module = module as? DictationTranscriber {
      reading = read(module.results) { $0.text }
    }
    // Sound heard before the model was ready waits in the sequence, so the first words are not lost.
    let starting = Task { try await analyzer.start(inputSequence: sequence) }
    self.starting = starting
    try await starting.value
  }

  /// Turns the microphone on. Its sound goes, made into what the model takes, to the analyzer.
  private func listen(_ module: any SpeechModule) async throws {
    #if os(iOS)
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true, options: .notifyOthersOnDeactivation)
    // A call coming in ends it, keeping what was said.
    watching.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] _ in
      Task { @MainActor in await self?.stop() }
    })
    #endif
    // The microphone was unplugged, another became the one to use, or headphones switched to their
    // own: listening goes on with the one there is now, or ends, keeping what was said, if there is none.
    watching.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      Task { @MainActor in
        guard let self, !self.over else { return }
        do {
          try await self.tapMicrophone(module)
        } catch {
          await self.stop()
        }
      }
    })
    try await tapMicrophone(module)
  }

  private func tapMicrophone(_ module: any SpeechModule) async throws {
    let node = engine.inputNode
    node.removeTap(onBus: 0)
    let heard = node.outputFormat(forBus: 0)
    guard heard.channelCount > 0, heard.sampleRate > 0 else {
      throw DictationFailure(code: "no-microphone", message: "There is no microphone to listen with.")
    }
    let tap = try await Tap(from: heard, for: module, into: input!, send: send)
    if over { return }
    node.installTap(onBus: 0, bufferSize: 2048, format: heard) { buffer, _ in tap.heard(buffer) }
    engine.prepare()
    try engine.start()
  }

  /// Hears a recording as fast as it can be read, then nothing until stopped.
  private func hear(_ recording: URL, _ module: any SpeechModule) async throws {
    let file = try AVAudioFile(forReading: recording)
    let tap = try await Tap(from: file.processingFormat, for: module, into: input!, send: send)
    while file.framePosition < file.length, let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096) {
      try file.read(into: buffer)
      tap.heard(buffer)
    }
  }

  private func endListening() {
    watching.forEach(NotificationCenter.default.removeObserver)
    watching = []
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    input?.finish()
    #if os(iOS)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    #endif
  }

  private func fail(_ error: Error) {
    guard !over else { return }
    over = true
    endListening()
    reading?.cancel()
    let analyzer = analyzer
    Task { await analyzer?.cancelAndFinishNow() }
    let failure = error as? DictationFailure ?? DictationFailure(code: "failed", message: error.localizedDescription)
    send(.failed(code: failure.code, message: failure.message))
  }

  /// Follows the model's results: each settles a piece of what was said, or guesses at what follows it.
  private func read<Results: AsyncSequence>(_ results: Results, text: @escaping (Results.Element) -> AttributedString) -> Task<Void, Never> where Results.Element: SpeechModuleResult {
    Task {
      do {
        for try await result in results {
          let words = String(text(result).characters)
          if result.isFinal {
            settled += words
            guess = ""
          } else {
            guess = words
          }
          send(.text(settled: settled, guess: guess))
        }
      } catch {
        if !Task.isCancelled { fail(error) }
      }
    }
  }

  /// The model to listen with. The newer one (SpeechTranscriber) where it knows the language, and
  /// the keyboard's dictation model, which knows more languages, where it does not.
  private static func module(for wanted: String?) async throws -> (any SpeechModule, Locale) {
    let asked = wanted.map { [Locale(identifier: $0)] } ?? (Locale.preferredLanguages.map { Locale(identifier: $0) } + [Locale.current])
    if SpeechTranscriber.isAvailable {
      for language in asked {
        if let locale = await SpeechTranscriber.supportedLocale(equivalentTo: language) {
          return (SpeechTranscriber(locale: locale, preset: .progressiveTranscription), locale)
        }
      }
    }
    for language in asked {
      if let locale = await DictationTranscriber.supportedLocale(equivalentTo: language) {
        return (DictationTranscriber(locale: locale, preset: .progressiveLongDictation), locale)
      }
    }
    throw DictationFailure(code: "language", message: wanted == nil ? "Dictation does not know any of your languages yet." : "Dictation does not know that language.")
  }

  private static func microphoneAllowed() async -> Bool {
    #if os(iOS)
    return await AVAudioApplication.requestRecordPermission()
    #else
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
    default: return false
    }
    #endif
  }
}

/// Where the microphone's sound goes as it is heard, off the main thread: made into what the model
/// takes, passed on, and measured for how loud it is.
@available(iOS 26, macOS 26, *)
private final class Tap: @unchecked Sendable {
  private let converter: AVAudioConverter
  private let format: AVAudioFormat
  private let input: AsyncStream<AnalyzerInput>.Continuation
  private let send: @Sendable (DictationEvent) -> Void
  private var loudest: Float = 0
  private var measured = Date.distantPast

  init(from heard: AVAudioFormat, for module: any SpeechModule, into input: AsyncStream<AnalyzerInput>.Continuation, send: @escaping @Sendable (DictationEvent) -> Void) async throws {
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module], considering: heard), let converter = AVAudioConverter(from: heard, to: format) else {
      throw DictationFailure(code: "failed", message: "The microphone’s sound could not be made into something the speech model takes.")
    }
    self.format = format
    self.converter = converter
    self.input = input
    self.send = send
  }

  func heard(_ buffer: AVAudioPCMBuffer) {
    measure(buffer)
    let room = AVAudioFrameCount((Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate).rounded(.up))
    guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: room) else { return }
    var given = false
    var error: NSError?
    // "No data now", not "end of stream", keeps the converter going from one buffer to the next.
    converter.convert(to: converted, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return buffer
    }
    if error == nil, converted.frameLength > 0 { input.yield(AnalyzerInput(buffer: converted)) }
  }

  /// The loudest moment since it was last told, in steps that go from a quiet room to raised voices.
  private func measure(_ buffer: AVAudioPCMBuffer) {
    guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
    var sum: Float = 0
    for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
    let decibels = 20 * log10(max(sqrt(sum / Float(buffer.frameLength)), 0.000_001))
    loudest = max(loudest, min(1, max(0, (decibels + 55) / 45)))
    let now = Date()
    guard now.timeIntervalSince(measured) >= 1 / 15 else { return }
    send(.level(loudest))
    loudest = 0
    measured = now
  }
}
