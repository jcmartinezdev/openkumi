// The superpowers a bot does not have yet, by the catalog's groups (one that is in several groups is
// in each, as on the computer), each a tap from being activated for it. Reached from the bot's
// settings, which list only the ones it has.
import { useEffect } from 'react'
import { Text } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { Superpower } from '@openkumi/shared'
import { api, useStore } from '@openkumi/client/store'
import { SuperpowerIcon } from '../../src/icons'
import { ICON_INSET, Note, Row, Section, SettingsPage, Slot } from '../../src/SettingsUi'
import { usePowers } from '../../src/superpowers'
import { useTheme } from '../../src/theme'

export default function AddSuperpower() {
  const theme = useTheme()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const powers = useStore((s) => s.superpowers)
  const listed = useStore((s) => s.superpowerCategories)
  const { activate } = usePowers(bot)
  useEffect(() => void api('POST', `/api/bots/${botId}/superpowers/check`).catch(() => {}), [botId])
  if (!bot) return null

  const left = powers.filter((p) => !bot.superpowers.includes(p.id))
  const categories = listed.length ? listed : [...new Set(powers.flatMap((p) => p.categories))]
  const groups = new Map<string, Superpower[]>(categories.map((c) => [c, left.filter((p) => p.categories.includes(c))]))
  const loose = left.filter((p) => !p.categories.some((c) => categories.includes(c)))
  if (loose.length) groups.set('More', loose)
  for (const [c, list] of groups) if (!list.length) groups.delete(c)

  return (
    <SettingsPage title="Add a superpower" subtitle={bot.name}>
      <Note>What {bot.name} can do beyond its own tools. Only you can activate one; the bot cannot.</Note>
      {[...groups].map(([group, list]) => (
        <Section key={group} title={group} inset={ICON_INSET}>
          {list.map((power) => (
            <Row
              key={power.id}
              leading={<Slot><SuperpowerIcon power={power} /></Slot>}
              label={power.name}
              detail={<Text style={{ color: theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{power.tagline}</Text>}
              accessibilityHint={`Gives ${bot.name} ${power.name}`}
              onPress={() => activate(bot, power)}
            />
          ))}
        </Section>
      ))}
      {!groups.size && <Note>{bot.name} has every superpower there is.</Note>}
    </SettingsPage>
  )
}
