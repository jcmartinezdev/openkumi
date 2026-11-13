// The first screen, while this phone is paired with no computer: a few bots say hello, and under
// them are the ways to start. For now there is one, pairing with the computer the bots run on
// (pair.tsx); others will join it in the list.
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type Href, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia'
import type { Look } from '@openkumi/shared'
import { BODY_COLORS, describeLook, surprise } from '@openkumi/client/mascot'
import { Glyph, type GlyphName } from '../src/icons'
import { Mascot } from '../src/Mascot'
import { useAppearance, useTheme } from '../src/theme'

interface Dress {
  look: Look
  emoji: string
}

/** Who says hello: OpenKumi's own bear in front, waving, between two of the crew on the website. */
const CREW: Dress[] = [
  { look: { creature: 'cat', color: 'periwinkle', hat: 'grad', extra: 'glasses', clothes: 'navy' }, emoji: '🔬' },
  { look: { creature: 'bear', color: 'sky', hat: 'headphones', extra: 'none', clothes: 'orange' }, emoji: '👋' },
  { look: { creature: 'blob', color: 'tangerine', hat: 'chef', extra: 'bowtie', clothes: 'red' }, emoji: '🍳' },
]

/** The ways to start. Pairing is the only one for now; the others will go here. */
const STARTS: { key: string; icon: GlyphName; title: string; detail: string; to: Href }[] = [
  { key: 'pair', icon: 'monitor', title: 'Pair with your computer', detail: 'Your bots run on it. Scan the code it shows, or type it in.', to: '/pair' },
]

/** Bits of sparkle around the crew, placed as fractions of the space it stands in. */
const SPARKLES: { x: number; y: number; size: number; color: string; star?: boolean }[] = [
  { x: 0.08, y: 0.2, size: 16, color: BODY_COLORS.lemon.hex, star: true },
  { x: 0.9, y: 0.12, size: 9, color: BODY_COLORS.berry.hex },
  { x: 0.86, y: 0.5, size: 18, color: BODY_COLORS.sky.hex, star: true },
  { x: 0.16, y: 0.62, size: 8, color: BODY_COLORS.mint.hex },
  { x: 0.52, y: 0.02, size: 10, color: BODY_COLORS.grape.hex, star: true },
  { x: 0.03, y: 0.44, size: 7, color: BODY_COLORS.coral.hex },
  { x: 0.96, y: 0.74, size: 7, color: BODY_COLORS.lime.hex },
]

/** Whether the phone is set to reduce motion. The bots then keep still, and only change clothes. */
function useStill() {
  const [still, setStill] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill)
    const listening = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill)
    return () => listening.remove()
  }, [])
  return still
}

const up = (height: Animated.Value, duration: number) => Animated.timing(height, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true })
/** Back to the ground, bouncing as it lands. */
const down = (height: Animated.Value, duration: number) => Animated.timing(height, { toValue: 0, duration, easing: Easing.bounce, useNativeDriver: true })

/** One of the crew: pops up when the screen opens, hops now and then, and when tapped jumps into new clothes. */
function Hopper({ start, size, order, still, lifted = 0 }: { start: Dress; size: number; order: number; still: boolean; lifted?: number }) {
  const theme = useTheme()
  const [dress, setDress] = useState(start)
  // 0 before it has come in, 1 once it has.
  const shown = useRef(new Animated.Value(0)).current
  // How far off the ground it is: a little for the hops it does by itself, all the way when tapped.
  const idle = useRef(new Animated.Value(0)).current
  const leap = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (still) {
      ;[shown, idle, leap].forEach((value) => value.stopAnimation())
      shown.setValue(1)
      idle.setValue(0)
      leap.setValue(0)
      return
    }
    Animated.spring(shown, { toValue: 1, delay: 250 + order * 170, friction: 5, tension: 70, useNativeDriver: true }).start()
    // Each at its own pace, so they do not hop together.
    const hops = Animated.loop(Animated.sequence([Animated.delay(2400 + order * 1300), up(idle, 170), down(idle, 420)]))
    hops.start()
    return () => hops.stop()
  }, [still])

  const poke = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (still) return setDress(surprise())
    leap.stopAnimation()
    // The clothes change at the top of the jump.
    up(leap, 200).start(({ finished }) => finished && (setDress(surprise()), down(leap, 640).start()))
  }

  const height = Animated.add(Animated.multiply(idle, 0.2), leap)
  const rise = height.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.36] })
  const translateY = Animated.add(shown.interpolate({ inputRange: [0, 1], outputRange: [size * 0.35, 0] }), rise)
  const scale = shown.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] })
  // Stretched a little while in the air.
  const scaleY = height.interpolate({ inputRange: [0, 0.25, 1.2], outputRange: [1, 1.06, 1.03], extrapolate: 'clamp' })
  const scaleX = height.interpolate({ inputRange: [0, 0.25, 1.2], outputRange: [1, 0.95, 0.97], extrapolate: 'clamp' })
  const opacity = shown.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: 'clamp' })
  // The shadow stays on the ground, smaller and fainter the higher the bot goes.
  const shadow = height.interpolate({ inputRange: [0, 1.2], outputRange: [1, 0.45], extrapolate: 'clamp' })

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={describeLook(dress.look)} accessibilityHint="Dresses this bot differently" onPress={poke} style={{ alignItems: 'center', marginBottom: lifted }}>
      <Animated.View style={{ opacity, transformOrigin: 'bottom', transform: [{ translateY }, { scale }, { scaleX }, { scaleY }] }}>
        <Mascot look={dress.look} emoji={dress.emoji} size={size} live={!still} />
      </Animated.View>
      <Animated.View style={[styles.shadow, { width: size * 0.5, height: size * 0.07, marginTop: -size * 0.1, backgroundColor: theme.border, opacity: Animated.multiply(opacity, shadow), transform: [{ scale: shadow }] }]} />
    </Pressable>
  )
}

/** A sparkle that comes and goes. */
function Sparkle({ x, y, size, color, star, order, still }: (typeof SPARKLES)[number] & { order: number; still: boolean }) {
  const glow = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (still) return glow.setValue(1)
    const half = (toValue: number) => Animated.timing(glow, { toValue, duration: 1300 + order * 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    const twinkles = Animated.loop(Animated.sequence([half(0), Animated.delay(order * 180), half(1)]))
    twinkles.start()
    return () => twinkles.stop()
  }, [still])
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }, { rotate: `${order * 23}deg` }],
      }}
    >
      {star ? <Glyph name="star" size={size} color={color} weight={1.4} filled /> : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />}
    </Animated.View>
  )
}

export default function Welcome() {
  const theme = useTheme()
  const appearance = useAppearance()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const still = useStill()

  // The crew stands on a stage as wide as the phone, up to a point (an iPad's is not much wider).
  const stage = Math.min(width, 440)
  const front = stage * 0.42
  const back = stage * 0.32
  const tall = front * 1.12 + stage * 0.16
  // A soft light behind them, in two of the bots' colours, on a canvas wider than the stage so it
  // fades out before its edges.
  const glow = appearance === 'dark' ? '30' : '38'
  const pad = stage * 0.2

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={[styles.page, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
      <View style={styles.hero}>
        <View style={[styles.stage, { width: stage, height: tall }]}>
          <Canvas style={{ position: 'absolute', left: -pad, top: -pad, width: stage + pad * 2, height: tall + pad * 2 }}>
            <Circle cx={pad + stage * 0.36} cy={pad + tall * 0.55} r={stage * 0.42}>
              <RadialGradient c={vec(pad + stage * 0.36, pad + tall * 0.55)} r={stage * 0.42} colors={[`${BODY_COLORS.sky.hex}${glow}`, `${BODY_COLORS.sky.hex}00`]} />
            </Circle>
            <Circle cx={pad + stage * 0.66} cy={pad + tall * 0.5} r={stage * 0.38}>
              <RadialGradient c={vec(pad + stage * 0.66, pad + tall * 0.5)} r={stage * 0.38} colors={[`${BODY_COLORS.berry.hex}${glow}`, `${BODY_COLORS.berry.hex}00`]} />
            </Circle>
          </Canvas>
          {SPARKLES.map((sparkle, i) => <Sparkle key={i} {...sparkle} order={i} still={still} />)}
          <View style={styles.crew}>
            <Hopper start={CREW[0]} size={back} order={1} still={still} lifted={back * 0.12} />
            <View style={{ zIndex: 1, marginHorizontal: -stage * 0.06 }}>
              <Hopper start={CREW[1]} size={front} order={0} still={still} />
            </View>
            <Hopper start={CREW[2]} size={back} order={2} still={still} lifted={back * 0.12} />
          </View>
        </View>
        <Text style={[styles.hint, { color: theme.faint }]}>Tap a bot to dress it up</Text>

        <View style={styles.words}>
          <Text style={[styles.eyebrow, { color: theme.muted }]}>Welcome to OpenKumi</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{'Your own crew\nof AI bots'}</Text>
          <Text style={[styles.lead, { color: theme.muted }]}>
            They live on your computer and get things done for you, each with its own memory and its own browser. On this phone you chat with them and watch them work, at home or away.
          </Text>
        </View>
      </View>

      <View style={styles.starts}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.muted }]}>Get started</Text>
        {STARTS.map((start) => (
          <Pressable
            key={start.key}
            accessibilityRole="button"
            accessibilityLabel={start.title}
            accessibilityHint={start.detail}
            style={({ pressed }) => [styles.start, { borderColor: theme.border, backgroundColor: pressed ? theme.bubble : theme.card }]}
            onPress={() => router.push(start.to)}
          >
            <View style={[styles.icon, { backgroundColor: theme.bubble }]}>
              <Glyph name={start.icon} size={24} color={theme.text} weight={1.7} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.startTitle, { color: theme.text }]}>{start.title}</Text>
              <Text style={[styles.startDetail, { color: theme.muted }]}>{start.detail}</Text>
            </View>
            <Glyph name="chevron" size={18} color={theme.faint} weight={2} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // The ways to start stay at the bottom; the crew and the words above them share the middle.
  page: { flexGrow: 1, paddingHorizontal: 20 },
  hero: { flexGrow: 1, justifyContent: 'center', paddingBottom: 24 },
  stage: { alignSelf: 'center', justifyContent: 'flex-end' },
  crew: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  shadow: { borderRadius: 999 },
  hint: { textAlign: 'center', fontSize: 13, marginTop: 6 },
  words: { gap: 8, marginTop: 28 },
  eyebrow: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  lead: { fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 4 },
  starts: { gap: 8 },
  heading: { fontSize: 13, fontWeight: '500', paddingHorizontal: 4 },
  start: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  startTitle: { fontSize: 17, fontWeight: '600' },
  startDetail: { fontSize: 14, lineHeight: 19 },
})
