# The iPhone app's dictation (DictationModule.swift, around the engine in Dictation.swift).
Pod::Spec.new do |s|
  s.name = 'OpenKumiDictation'
  s.version = '0.1.0'
  s.summary = 'Dictation for OpenKumi, written down on the device.'
  s.author = 'Juan Cruz Martinez'
  s.homepage = 'https://openkumi.ai'
  s.license = 'MIT'
  # It builds for any iPhone the app runs on, and says for itself whether that one can take dictation (iOS 26 or later).
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'Dictation.swift', 'DictationModule.swift'
  s.frameworks = 'AVFoundation', 'Speech'
end
