// Where the app starts. The app itself is its screens (app/, which expo-router finds); before
// them comes what the app does when a car is its only screen (src/car.ts), which has to be there
// whether or not the phone's window ever opens.
import './src/car'
import 'expo-router/entry'
