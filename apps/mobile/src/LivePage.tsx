// A live picture of one tab of a bot's browser. Pictures arrive as JPEGs; the newest is decoded and
// shown, and the one before it let go.
import { useEffect, useRef, useState } from 'react'
import { type SkImage, Skia } from '@shopify/react-native-skia'
import { useStore } from '@openbot/client/store'
import { watch } from './session'

/** The newest picture of a tab, while `on`, and the size of the page in its own units (which taps are sent in). */
export function useLivePage(botId: string, tabId: string | undefined, on = true) {
  const connected = useStore((s) => s.connected)
  const [image, setImage] = useState<SkImage | null>(null)
  const page = useRef({ width: 1280, height: 800 })
  useEffect(() => {
    if (!tabId || !connected || !on) return
    setImage(null)
    let last: SkImage | null = null
    return watch(botId, tabId, (picture) => {
      // The JPEG is a slice of a longer message; it is copied out so the decoder gets it and nothing else.
      const next = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(picture.jpeg.slice()))
      if (!next) return
      page.current = { width: picture.width, height: picture.height }
      setImage(next)
      last?.dispose()
      last = next
    })
  }, [botId, tabId, connected, on])
  return { image, page: page.current }
}

/** Where a page of `page`'s size is drawn inside a box, keeping its shape. */
export function fit(page: { width: number; height: number }, box: { width: number; height: number }) {
  const scale = Math.min(box.width / page.width, box.height / page.height) || 1
  const width = page.width * scale
  const height = page.height * scale
  return { scale, width, height, x: (box.width - width) / 2, y: (box.height - height) / 2 }
}
