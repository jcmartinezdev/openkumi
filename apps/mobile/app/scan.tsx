// Reads the QR code the computer shows under "Pair a computer", which carries its address and the code.
import { useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { parsePairingLink } from '@openbot/client/pair'
import { useTheme } from '../src/theme'

export default function Scan() {
  const theme = useTheme()
  const router = useRouter()
  const [permission, ask] = useCameraPermissions()
  const done = useRef(false)

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={[styles.text, { color: theme.muted }]}>The camera is used only to read the pairing code on your computer’s screen.</Text>
        <Pressable accessibilityRole="button" style={[styles.button, { backgroundColor: theme.primary }]} onPress={ask}>
          <Text style={{ color: theme.onPrimary, fontSize: 16, fontWeight: '600' }}>Allow the camera</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <CameraView
      style={{ flex: 1 }}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }) => {
        const found = parsePairingLink(data)
        if (!found || done.current) return
        done.current = true
        router.dismissTo({ pathname: '/pair', params: found })
      }}
    />
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18 },
  text: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { height: 48, paddingHorizontal: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
