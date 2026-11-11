// In the composer: what the bot runs on now, and how hard it is set to think when that was chosen.
// Tapping it opens the model sheet (app/model/[botId].tsx).
import { Pressable, StyleSheet, Text } from 'react-native'
import type { Bot } from '@openbot/shared'
import { EFFORT_LABEL, useModels } from '@openbot/client/models'
import { useStore } from '@openbot/client/store'
import { Glyph, ProviderIcon } from './icons'
import { useTheme } from './theme'

export function ModelChip({ bot, onPress }: { bot: Bot; onPress: () => void }) {
  const theme = useTheme()
  const provider = useStore((s) => s.providers.find((p) => p.id === bot.provider))
  const models = useModels(bot.provider, provider?.connected)
  // No model stored means the provider's own default, which is the first it lists.
  const name = (bot.model ? models.find((m) => m.id === bot.model) : models[0])?.name ?? (bot.model || 'Default')
  const effort = bot.effort ? EFFORT_LABEL[bot.effort] : ''
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model: ${name}${effort ? `, ${effort} reasoning` : ''}`}
      accessibilityHint="Chooses what the bot runs on"
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed && { backgroundColor: theme.bubble }]}
      onPress={onPress}
    >
      {provider && <ProviderIcon provider={provider} size={17} color={theme.text} />}
      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{name}</Text>
      {!!effort && <Text style={{ color: theme.muted, fontSize: 15 }} numberOfLines={1}>· {effort}</Text>}
      <Glyph name="down" size={13} color={theme.muted} weight={2.2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, height: 36, paddingHorizontal: 10, borderRadius: 18 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '500' },
})
