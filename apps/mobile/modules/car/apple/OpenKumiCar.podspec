# The app on a car's screen, through CarPlay (Car.swift, CarSceneDelegate.swift, CarModule.swift).
Pod::Spec.new do |s|
  s.name = 'OpenKumiCar'
  s.version = '0.1.0'
  s.summary = 'Shows the bots on a car\'s screen, to call one from there.'
  s.author = 'Juan Cruz Martinez'
  s.homepage = 'https://openkumi.ai'
  s.license = 'MIT'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # For the app's way of starting React Native, when the car is the only screen the app is on.
  s.dependency 'Expo'
  s.source_files = '*.swift'
  s.frameworks = 'CarPlay', 'UIKit'
end
