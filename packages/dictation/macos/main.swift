// The desktop app's dictation on a Mac (apps/desktop/src/dictation.ts runs it). It listens until it
// is told to stop, and writes what it hears to its output, a line of JSON for each event:
//   dictation --check      says whether this Mac can take dictation, then ends
//   dictation [language]   listens; a line "stop" on its input finishes, "cancel" (or the input closing) gives up
// With OPENKUMI_DICTATION_RECORDING set to a sound file, that is heard instead of the microphone (for tests).
import Foundation

let writing = DispatchQueue(label: "output")

func write(_ fields: [String: Any]) {
  guard let line = try? JSONSerialization.data(withJSONObject: fields) else { return }
  writing.sync { FileHandle.standardOutput.write(line + Data("\n".utf8)) }
}

@main
struct Main {
  static func main() async {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard #available(macOS 26, *) else {
      if arguments.first == "--check" { write(["available": false]) }
      else { write(DictationEvent.failed(code: "unavailable", message: "Dictation needs macOS 26 or later.").fields) }
      exit(1)
    }
    if arguments.first == "--check" {
      write(["available": true])
      exit(0)
    }

    let dictation = Dictation { event in
      write(event.fields)
      // After its last word there is nothing more to do.
      if case .done = event { exit(0) }
      if case .failed = event { exit(1) }
    }
    let recording = ProcessInfo.processInfo.environment["OPENKUMI_DICTATION_RECORDING"].map { URL(fileURLWithPath: $0) }
    Task { await dictation.start(locale: arguments.first, recording: recording) }
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        if line == "stop" { await dictation.stop() }
        if line == "cancel" { break }
      }
    } catch {}
    // Given up, or the app is gone.
    await dictation.cancel()
    exit(0)
  }
}
