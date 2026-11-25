// A car's screen, through CarPlay (apple/Car.swift): what the app shows there, and what is tapped.
import { requireOptionalNativeModule } from 'expo'
import type { CarScreen } from '@openkumi/client/car'

export type CarAction = { id: 'hangUp' | 'noScreen' | 'mute' | 'unmute' | 'dismiss'; of: string }

interface Native {
  connected(): Promise<boolean>
  show(screen: CarScreen): Promise<void>
  keep(name: string, png: string): Promise<void>
  addListener(name: 'onConnected', listener: (event: { connected: boolean }) => void): { remove(): void }
  addListener(name: 'onPick', listener: (event: { id: string }) => void): { remove(): void }
  addListener(name: 'onAction', listener: (event: CarAction) => void): { remove(): void }
}

// Missing from an app built before it could be shown in a car.
export const car = requireOptionalNativeModule<Native>('OpenKumiCar')
