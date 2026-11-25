// The app in a car, through CarPlay: the bots as a list, and a tap on one calls it. The call is
// the same one the phone makes (src/calls.ts), with the car's microphone and loudspeakers, since
// the phone's sound is the car's while it is connected.
//
// A car's screen is not drawn by the app: CarPlay offers a few screens of its own to an app that
// is talked with, and modules/car puts on them what it is handed. So this is not a view. Each time
// what the app knows changes (the server, the bots, the call), what the car should show is worked
// out anew (@openkumi/client/car) and handed over whole. It runs from when the app starts
// (index.js), with or without the phone's own screens: in a car the phone is often locked, and the
// app not open on it.
import { AppRegistry } from 'react-native'
import { ImageFormat, Skia } from '@shopify/react-native-skia'
import { permissions } from 'react-native-webrtc'
import type { Bot } from '@openkumi/shared'
import { call, callingNow, dismissCallError, hangUp, mute, onCalling } from '@openkumi/client/calls'
import { type CarAlert, carScreen, faceOf, microphoneAlert } from '@openkumi/client/car'
import { UNDECIDED, mascotSvg } from '@openkumi/client/mascot'
import { onState, stateNow } from '@openkumi/client/store'
import { car } from '../modules/car'
// Gives the app its way of making calls.
import './calls'
import { onSession, restore, sessionNow } from './session'

// What the app is started with when a car is its only screen (modules/car/apple/CarSceneDelegate.swift):
// it draws nothing. The phone's screens come when the phone is looked at.
AppRegistry.registerComponent('car', () => () => null)

/** A car's screen is there to show on. */
let connected = false
/** The call under way was made from the car: it ends when the car goes. */
let fromCar = false
/** Something the car has to say that is not about a call under way, until it is dismissed. */
let said: CarAlert | null = null

// ---- the bots' faces

/** The faces handed to the car so far, by name. */
const drawn = new Set<string>()
/** As many points as the largest place a face goes (the call's screen), three times over for a sharp screen. */
const FACE = 450

/** Draws the bot's face and hands it to the car, unless it has it. Without one, the car draws the bot's emoji. */
function draw(bot: Bot) {
  const name = faceOf(bot.look)
  if (drawn.has(name)) return
  drawn.add(name)
  try {
    const svg = Skia.SVG.MakeFromString(mascotSvg(bot.look ?? UNDECIDED, '', { crop: 'head', bare: true }))
    const surface = Skia.Surface.Make(FACE, FACE)
    if (!svg || !surface) return
    surface.getCanvas().drawSvg(svg, FACE, FACE)
    surface.flush()
    void car?.keep(name, surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100)).catch(() => {})
  } catch {
    // The emoji it is, then.
  }
}

// ---- what the car shows

/** What the car was last handed, so that it is only handed what differs. */
let shown = ''
let waiting = false
/** Hands the car what it should show now. What the app knows changes many times a second while a bot writes: those are taken together. */
function show() {
  if (!connected || waiting) return
  waiting = true
  setTimeout(() => {
    waiting = false
    if (!connected) return
    const { server, ready, locked } = sessionNow()
    const state = stateNow()
    const next = carScreen({ server, ready, locked, state, calling: callingNow(), said })
    const text = JSON.stringify(next)
    if (text === shown) return
    shown = text
    if (next.rows.length) state.bots.forEach(draw)
    void car?.show(next).catch(() => {})
  }, 40)
}

// ---- what is tapped there

/** Calls the bot whose row was tapped. */
async function pick(botId: string) {
  if (callingNow().phase !== 'off') return
  // The phone asks whether the app may listen on its own screen, which nobody is looking at here:
  // a call is only made once it may.
  let microphone = 'granted'
  try {
    microphone = await permissions.query({ name: 'microphone' })
  } catch {
    // Not known: the call finds out.
  }
  // Asking took a moment, in which the car may have gone or a call begun.
  if (!connected || callingNow().phase !== 'off') return
  said = microphoneAlert(microphone)
  if (said) return show()
  fromCar = true
  void call(botId)
}

/** Whether what the app knows is being followed yet: it is from the first car on, and not at all in an app no car shows. */
let following = false
function follow() {
  if (following) return
  following = true
  onState(show)
  onSession(show)
  onCalling(() => {
    if (callingNow().phase === 'off') fromCar = false
    show()
  })
  // The phone's screens read the saved server when they open; for a car it is read whether they do or not.
  void restore()
}

function setConnected(now: boolean) {
  if (connected === now) return
  connected = now
  if (now) {
    follow()
    // A car starts from nothing each time.
    shown = ''
    show()
  } else {
    said = null
    // The call was for the drive: it does not go on from the phone's loudspeaker, in a pocket.
    if (fromCar && callingNow().phase !== 'off') void hangUp()
  }
}

if (car) {
  car.addListener('onConnected', (event) => setConnected(event.connected))
  car.addListener('onPick', (event) => void pick(event.id))
  car.addListener('onAction', (event) => {
    if (event.id === 'hangUp') void hangUp()
    // The car would not show the call's screen: a call made from it cannot go on without one. One made on the phone can.
    else if (event.id === 'noScreen') {
      if (fromCar) void hangUp()
    } else if (event.id === 'mute') mute(true)
    else if (event.id === 'unmute') mute(false)
    else {
      said = null
      dismissCallError()
      show()
    }
  })
  // A car that was there before the app was: the app is told of the ones that come after.
  car.connected().then(setConnected, () => {})
}
