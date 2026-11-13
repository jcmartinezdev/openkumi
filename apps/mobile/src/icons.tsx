// Icons drawn with Skia from path data on a 24-unit square: the providers' marks (shared with the
// computer, @openkumi/client/marks) and the few line icons the phone needs, drawn as the computer's are.
// Superpowers bring app icons of their own, as SVG, which Skia draws as they are.
import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { Canvas, Group, ImageSVG, Path, Skia } from '@shopify/react-native-skia'
import type { ProviderInfo, Superpower } from '@openkumi/shared'
import { markOf } from '@openkumi/client/marks'
import { useTheme } from './theme'

// Circles are written as two arcs, which is all a path can say.
const GLYPHS = {
  check: 'm5 12 5 5 9-10',
  chevron: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  up: 'M12 19V5M5 12l7-7 7 7',
  plus: 'M12 5v14M5 12h14',
  search: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zm2 9-4-4',
  star: 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z',
  x: 'M18 6 6 18M6 6l12 12',
  play: 'M8 5.5v13l10-6.5z',
  sun: 'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  monitor: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h8M12 16v4',
  cpu: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  sliders: 'M4 7h9M19 7h1M4 17h3M13 17h7M13.5 7a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M7.5 17a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0',
  clock: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3.5 2',
  compass: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M15.5 8.5l-2 5-5 2 2-5z',
  info: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 11v5M12 8h.01',
  globe: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z',
}

export type GlyphName = keyof typeof GLYPHS

/** A path, filled or drawn as a line (or both, which keeps a filled shape's corners round). */
function Drawn({ d, size, color, fill, stroke }: { d: string; size: number; color: string; fill?: boolean; stroke?: number }) {
  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: size / 24 }]}>
        {fill && <Path path={d} color={color} />}
        {!!stroke && <Path path={d} color={color} style="stroke" strokeWidth={stroke} strokeCap="round" strokeJoin="round" />}
      </Group>
    </Canvas>
  )
}

export function Glyph({ name, size = 16, color, weight = 1.8, filled = false }: { name: keyof typeof GLYPHS; size?: number; color: string; weight?: number; filled?: boolean }) {
  return <Drawn d={GLYPHS[name]} size={size} color={color} fill={filled} stroke={weight} />
}

/** A provider's mark. Claude's keeps its own colour; the others take `color`, which is the text's. */
export function ProviderIcon({ provider, size = 16, color }: { provider: Pick<ProviderInfo, 'id' | 'detail'>; size?: number; color: string }) {
  const mark = markOf(provider)
  return <Drawn d={mark.d} size={size} color={mark.color ?? color} fill={!mark.stroke} stroke={mark.stroke} />
}

/** A superpower's app icon with rounded corners, or its first letter when it has none. */
export function SuperpowerIcon({ power, size = 28 }: { power: Pick<Superpower, 'icon' | 'name'>; size?: number }) {
  const theme = useTheme()
  const svg = useMemo(() => (power.icon ? Skia.SVG.MakeFromString(power.icon) : null), [power.icon])
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.24, overflow: 'hidden', backgroundColor: theme.side, alignItems: 'center', justifyContent: 'center' }}>
      {svg ? (
        <Canvas style={{ width: size, height: size }}><ImageSVG svg={svg} x={0} y={0} width={size} height={size} /></Canvas>
      ) : (
        <Text style={{ color: theme.muted, fontWeight: '600', fontSize: size * 0.45 }}>{power.name.slice(0, 1)}</Text>
      )}
    </View>
  )
}
