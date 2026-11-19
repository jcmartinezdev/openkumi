# Where a call's sound comes out on the iPhone (CallAudioModule.swift).
Pod::Spec.new do |s|
  s.name = 'OpenKumiCallAudio'
  s.version = '0.1.0'
  s.summary = 'Puts the sound of a call with a bot on the loudspeaker or at the ear.'
  s.author = 'Juan Cruz Martinez'
  s.homepage = 'https://openkumi.ai'
  s.license = 'MIT'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'CallAudioModule.swift'
  s.frameworks = 'AVFoundation', 'UIKit'
end
