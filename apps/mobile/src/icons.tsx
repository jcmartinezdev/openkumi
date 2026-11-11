// Icons drawn with Skia from path data on a 24-unit square: the providers' marks (shared with the
// computer, @openbot/client/marks) and the few line icons the phone needs, drawn as the computer's are.
import { Canvas, Group, Path } from '@shopify/react-native-skia'
import type { ProviderInfo } from '@openbot/shared'
import { markOf } from '@openbot/client/marks'

const GLYPHS = {
  check: 'm5 12 5 5 9-10',
  down: 'm6 9 6 6 6-6',
  up: 'M12 19V5M5 12l7-7 7 7',
  search: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zm2 9-4-4',
  star: 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z',
  x: 'M18 6 6 18M6 6l12 12',
}

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
