// A bot's look, as on the computer's page for the bot: the emoji on its sign, the creature, its
// colour and what it wears, each choice shown on the bot's own head. Saved as it is chosen.
import { type ReactNode, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import type { Look } from '@openkumi/shared'
import { api, useStore } from '@openkumi/client/store'
import { BODY_COLORS, CLOTHES_COLORS, CREATURES, EXTRAS, HATS, SIGN_EMOJIS, describeLook, surprise } from '@openkumi/client/mascot'
import { Mascot } from '../../../src/Mascot'
import { Section, SettingsPage } from '../../../src/SettingsUi'
import { useTheme } from '../../../src/theme'

interface Dress {
  look: Look
  emoji: string
}

export default function LookSettings() {
  const theme = useTheme()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const stored = useStore((s) => s.bots.find((b) => b.id === botId))
  /** What was just chosen, shown at once instead of when the server has said so. */
  const [shown, setShown] = useState<Dress | null>(null)
  const [picking, setPicking] = useState(false)
  /** What is in the emoji box while it is being typed in, which may be nothing for a moment. */
  const [typed, setTyped] = useState<string | null>(null)
  useEffect(() => setShown(null), [stored?.look, stored?.emoji])
  if (!stored) return null
  const dress = shown ?? { look: stored.look, emoji: stored.emoji }

  const change = (patch: { look?: Partial<Look>; emoji?: string }) => {
    void Haptics.selectionAsync()
    setShown({ look: { ...dress.look, ...patch.look }, emoji: patch.emoji ?? dress.emoji })
    api('PATCH', `/api/bots/${stored.id}`, patch).catch((e) => (setShown(null), Alert.alert('Not saved', (e as Error).message)))
  }
  const pick = async () => {
    setPicking(true)
    try {
      change(await api<Dress>('POST', '/api/looks/pick', { botId: stored.id }))
    } catch (e) {
      Alert.alert('No look chosen', (e as Error).message)
    } finally {
      setPicking(false)
    }
  }

  /** One part to choose, each choice shown on the bot's head. */
  const parts = <K extends 'creature' | 'hat' | 'extra'>(title: string, key: K, names: Record<Look[K], string>) => (
    <Section title={title} bare>
      <Card>
        {(Object.entries(names) as [Look[K], string][]).map(([value, name]) => {
          const on = dress.look[key] === value
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.tile, { borderColor: on ? theme.text : 'transparent', backgroundColor: on || pressed ? theme.bubble : 'transparent' }]}
              onPress={() => change({ look: { [key]: value } })}
            >
              <Mascot look={{ ...dress.look, [key]: value }} emoji={dress.emoji} size={46} crop="head" />
              <Text style={[styles.tileName, { color: on ? theme.text : theme.muted }]} numberOfLines={1}>{name}</Text>
            </Pressable>
          )
        })}
      </Card>
    </Section>
  )
  const colors = <K extends 'color' | 'clothes'>(title: string, key: K, names: Record<Look[K], { name: string; hex: string }>) => (
    <Section title={title} bare>
      <Card>
        {(Object.entries(names) as [Look[K], { name: string; hex: string }][]).map(([value, { name, hex }]) => {
          const on = dress.look[key] === value
          return (
            <Pressable key={value} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected: on }} hitSlop={4} style={[styles.ring, { borderColor: on ? theme.text : 'transparent' }]} onPress={() => change({ look: { [key]: value } })}>
              <View style={[styles.swatch, { backgroundColor: hex }]} />
            </Pressable>
          )
        })}
      </Card>
    </Section>
  )

  return (
    <SettingsPage title="Look" subtitle={stored.name} buttons={2}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="sparkles" accessibilityLabel="Pick for me" disabled={picking} onPress={pick} />
        <Stack.Toolbar.Button icon="dice" accessibilityLabel="Surprise me" disabled={picking} onPress={() => change(surprise())} />
      </Stack.Toolbar>

      <View style={styles.hero}>
        <Mascot look={dress.look} emoji={dress.emoji} size={150} live />
        <View style={styles.caption}>
          {(picking || stored.choosingLook) && <ActivityIndicator size="small" color={theme.muted} />}
          <Text style={{ color: theme.muted, fontSize: 14 }}>{picking || stored.choosingLook ? `${stored.name} is choosing its look…` : describeLook(dress.look)}</Text>
        </View>
      </View>

      <Section title="Sign" bare>
        <Card>
          <TextInput
            accessibilityLabel="Emoji on the sign"
            value={typed ?? dress.emoji}
            maxLength={8}
            selectTextOnFocus
            // Outlined, so that it reads as a box to type in, not as one of the emoji beside it.
            style={[styles.emojiField, { color: theme.text, borderColor: theme.border }]}
            onChangeText={(text) => (setTyped(text), text.trim() && change({ emoji: text.trim() }))}
            onBlur={() => setTyped(null)}
          />
          {SIGN_EMOJIS.map((emoji) => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={emoji} accessibilityState={{ selected: dress.emoji === emoji }} style={[styles.emoji, dress.emoji === emoji && { backgroundColor: theme.bubble }]} onPress={() => change({ emoji })}>
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </Pressable>
          ))}
        </Card>
      </Section>
      {parts('Creature', 'creature', CREATURES)}
      {colors('Colour', 'color', BODY_COLORS)}
      {parts('Hat', 'hat', HATS)}
      {parts('Extra', 'extra', EXTRAS)}
      {colors('Clothes colour', 'clothes', CLOTHES_COLORS)}
    </SettingsPage>
  )
}

/** A card that lays what it holds out in rows, rather than one row each. */
function Card({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return <View style={[styles.card, { backgroundColor: theme.groupCard }]}>{children}</View>
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, marginBottom: -6 },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  card: { borderRadius: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 10 },
  tile: { width: 62, alignItems: 'center', gap: 2, paddingTop: 6, paddingBottom: 5, borderRadius: 12, borderWidth: 1.5 },
  tileName: { fontSize: 11.5 },
  ring: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  emojiField: { width: 56, height: 40, borderRadius: 10, borderWidth: 1, fontSize: 22, textAlign: 'center', marginRight: 4 },
  emoji: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
})
