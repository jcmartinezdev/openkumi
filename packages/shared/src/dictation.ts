// What a dictation on the device says while it runs: the same from the Mac's program and from the
// iPhone's module (packages/dictation/apple/Dictation.swift sends these).

export type DictationEvent =
  /** Fetching the speech model for the language, which happens the first time only. `progress` is 0–1. */
  | { type: 'preparing'; progress: number }
  /** The microphone is on, listening for this language (a tag like "en-US"). */
  | { type: 'listening'; locale: string }
  /** How loud it is, from 0 to 1, about fifteen times a second. */
  | { type: 'level'; level: number }
  /** What has been said: the part that is settled, and the latest guess at what came after it. */
  | { type: 'text'; settled: string; guess: string }
  /** It is over, and this is everything that was said. */
  | { type: 'done'; text: string }
  | { type: 'failed'; code: DictationFailure; message: string }

/**
 * Why a dictation could not go on: the device cannot take dictation, the app may not use the
 * microphone, there is no microphone, no model knows the language, or anything else.
 */
export type DictationFailure = 'unavailable' | 'denied' | 'no-microphone' | 'language' | 'failed'

/** A device's way of taking dictation. One dictation runs at a time; starting another ends the one before. */
export interface Listener {
  /** Starts listening for `locale`, or else for the first of the device's languages a model knows. */
  start(locale?: string): Promise<void>
  /** Stops listening. The last words are settled, then `done` says everything that was said. */
  stop(): Promise<void>
  /** Gives up. Nothing more is said. */
  cancel(): Promise<void>
  /** Called with what the dictation says. Returns a function that stops the calls. */
  onEvent(listener: (event: DictationEvent) => void): () => void
}
