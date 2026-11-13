// Pairing this phone with the computer that runs the bots, the way to start that the welcome offers
// (or where a pairing link opens). The computer shows its address and a code (and both as a QR
// code); the code works once and is checked on both sides.
import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Device from 'expo-constants'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScreenTitle } from '../src/ScreenTitle'
import { pairWith } from '../src/session'
import { useTheme } from '../src/theme'

export default function Pair() {
  const theme = useTheme()
  const router = useRouter()
  // Filled in by the scanner, or by opening a pairing link.
  const given = useLocalSearchParams<{ address?: string; code?: string }>()
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const connect = async (to = address, using = code) => {
    setError('')
    setBusy(true)
    try {
      await pairWith(to, using, Device.default.deviceName ?? 'iPhone')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  useEffect(() => {
    if (!given.address || !given.code) return
    setAddress(given.address)
    setCode(given.code)
    void connect(given.address, given.code)
  }, [given.address, given.code])

  const input = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenTitle title="Pair with your computer" />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={[styles.lead, { color: theme.muted }]}>
          On the computer that runs your bots, open Settings, then Environments, switch on “Let other computers connect” and choose “Pair a computer”.
        </Text>
        <Pressable accessibilityRole="button" style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => router.push('/scan')}>
          <Text style={[styles.buttonText, { color: theme.onPrimary }]}>Scan the code</Text>
        </Pressable>
        <Text style={[styles.or, { color: theme.faint }]}>or type what it shows</Text>
        <Text style={[styles.label, { color: theme.muted }]}>Address</Text>
        <TextInput accessibilityLabel="Address" style={input} value={address} onChangeText={setAddress} placeholder="192.168.1.20:4317" placeholderTextColor={theme.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Text style={[styles.label, { color: theme.muted }]}>Pairing code</Text>
        <TextInput accessibilityLabel="Pairing code" style={input} value={code} onChangeText={setCode} placeholder="ABCD-EFGH-JKMN" placeholderTextColor={theme.faint} autoCapitalize="characters" autoCorrect={false} />
        {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: theme.err }]}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy || !address.trim() || !code.trim()} style={[styles.button, { borderColor: theme.border, borderWidth: 1, opacity: busy || !address.trim() || !code.trim() ? 0.5 : 1 }]} onPress={() => connect()}>
          {busy ? <ActivityIndicator color={theme.text} /> : <Text style={[styles.buttonText, { color: theme.text }]}>Pair</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 10 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  or: { textAlign: 'center', fontSize: 13, marginVertical: 8 },
  label: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  input: { height: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  button: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 20 },
})
