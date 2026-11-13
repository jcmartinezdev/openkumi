// A bot's mascot on the phone: the computer's drawing (@openkumi/client/mascot), drawn by Skia from
// its SVG. Skia's SVG draws no emoji, so the emoji on the sign is text laid over it.
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { Canvas, ImageSVG, Skia } from '@shopify/react-native-skia'
import type { Bot, Look } from '@openkumi/shared'
import { HEAD_SIGN, SIGN, UNDECIDED, VIEWS, mascotSvg, signColors } from '@openkumi/client/mascot'

interface MascotProps {
  look: Look | undefined
  emoji: string
  /** Its width. */
  size: number
  crop?: keyof typeof VIEWS
  /** Breathes, slowly. Kept for the large ones. */
  live?: boolean
}

export function Mascot({ look, emoji, size, crop = 'full', live = false }: MascotProps) {
  // A server from before bots had looks sends none.
  const shape = look ?? UNDECIDED
  const view = VIEWS[crop]
  const scale = size / view.width
  const height = view.height * scale
  const svg = useMemo(() => Skia.SVG.MakeFromString(mascotSvg(shape, emoji, { crop, bare: true })), [shape.creature, shape.color, shape.hat, shape.extra, shape.clothes, crop])
  const breath = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!live) return
    const half = (toValue: number) => Animated.timing(breath, { toValue, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]))
    loop.start()
    return () => loop.stop()
  }, [live])
  const squish = live ? [{ scaleX: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }, { scaleY: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }] : []
  const box = SIGN.size * scale * 1.5
  return (
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height, transformOrigin: 'bottom', transform: squish }}>
      <Canvas style={{ width: size, height }}>{svg && <ImageSVG svg={svg} x={0} y={0} width={size} height={height} />}</Canvas>
      {crop === 'full' && (
        <Text
          style={[
            styles.emoji,
            { left: (SIGN.x - view.x) * scale - box / 2, top: (SIGN.y - view.y) * scale - box / 2, width: box, height: box, lineHeight: box, fontSize: SIGN.size * scale * 0.82, transform: [{ rotate: `${SIGN.angle}deg` }] },
          ]}
        >
          {emoji}
        </Text>
      )}
    </Animated.View>
  )
}

/**
 * A bot's head, where its avatar goes, holding up its sign so bots that look alike tell apart. The
 * row beside it says whose it is. `sign={false}` leaves the sign out where the bot is plain.
 */
export function BotHead({ bot, size = 32, sign = true }: { bot: Pick<Bot, 'look' | 'emoji'> | undefined; size?: number; sign?: boolean }) {
  const emoji = bot?.emoji ?? '🤖'
  if (!sign) return <Mascot look={bot?.look} emoji={emoji} size={size} crop="head" />
  const s = HEAD_SIGN
  const { card, paw, pawEdge } = signColors(bot?.look ?? UNDECIDED)
  const pawSize = s.paw * size
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size }}>
      <Mascot look={bot?.look} emoji={emoji} size={size} crop="head" />
      <View
        style={[
          styles.sign,
          { width: s.width * size, height: s.height * size, right: s.right * size, bottom: s.bottom * size, borderRadius: s.radius * size, backgroundColor: card, transform: [{ rotate: `${s.angle}deg` }] },
        ]}
      >
        <View style={[styles.paw, { width: pawSize, height: pawSize, left: -pawSize / 2, top: (s.height * size - pawSize) / 2, backgroundColor: paw, borderColor: pawEdge }]} />
        <Text allowFontScaling={false} style={{ fontSize: s.emoji * size }}>{emoji}</Text>
      </View>
    </View>
  )
}

/** Rocks what it holds from side to side, as a bot's head does while the bot is at work. */
export function Bobbing({ children }: { children: ReactNode }) {
  const swing = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const half = (toValue: number) => Animated.timing(swing, { toValue, duration: 500, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]))
    loop.start()
    return () => loop.stop()
  }, [])
  const rotate = swing.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] })
  const translateY = swing.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -2, 0] })
  return <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>{children}</Animated.View>
}

const styles = StyleSheet.create({
  emoji: { position: 'absolute', textAlign: 'center' },
  // The edge keeps the sign apart from a pale head or screen.
  sign: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.22)', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } },
  paw: { position: 'absolute', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
})
