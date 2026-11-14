// An automation's prompt on a screen of its own, with the room it needs. What is written goes
// straight into the automation's form underneath; going back keeps it there, and the form's Save
// saves the automation, as it always has. `key` is where the form offered it (src/handoff.ts).
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { handedOver } from '../../src/handoff'
import { ScreenTitle } from '../../src/ScreenTitle'
import { useTheme } from '../../src/theme'

export default function Prompt() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { key, title, bot } = useLocalSearchParams<{ key: string; title?: string; bot?: string }>()
  const form = handedOver(key)
  const [text, setText] = useState(() => form?.text() ?? '')
  return (
    <>
      <ScreenTitle title="Prompt" subtitle={title || 'New automation'} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.group }}
        contentContainerStyle={[styles.page, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {/* Above the text, where the keyboard cannot cover it. */}
        <Text style={[styles.hint, { color: theme.faint }]}>
          What {bot || 'the bot'} does each time. A run sees nothing of the conversation, so say everything it needs, and what to tell you.
        </Text>
        <View style={[styles.card, { backgroundColor: theme.groupCard }]}>
          <TextInput
            accessibilityLabel="Prompt"
            style={[styles.field, { color: theme.text }]}
            value={text}
            onChangeText={(next) => (setText(next), form?.change(next))}
            placeholder="Read the main headlines on a few news sites and give me the five that matter most, with a line on each."
            placeholderTextColor={theme.faint}
            editable={!!form}
            multiline
            autoFocus={!!form}
            scrollEnabled={false}
            autoCapitalize="sentences"
          />
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
  card: { borderRadius: 16, overflow: 'hidden' },
  field: { minHeight: 300, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, fontSize: 16.5, lineHeight: 23, textAlignVertical: 'top' },
})
