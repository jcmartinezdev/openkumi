import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router'
import { restore, useSession } from '../src/session'
import { useAppearance, useTheme } from '../src/theme'

export default function Layout() {
  const theme = useTheme()
  const appearance = useAppearance()
  const { server, ready } = useSession()
  const router = useRouter()
  const pairing = useSegments()[0] === 'pair'

  useEffect(() => void restore(), [])
  // With no server there is only one thing to do; once paired, the pairing screen is left.
  useEffect(() => {
    if (!ready) return
    if (!server && !pairing) router.replace('/pair')
    else if (server && pairing) router.replace('/')
  }, [ready, server, pairing])

  return (
    // Navigation draws its bars and their buttons and menus light unless told the app is dark.
    <ThemeProvider value={appearance === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text, headerShadowVisible: false, contentStyle: { backgroundColor: theme.bg }, headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="index" options={{ title: 'Open Bot' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair with your computer', headerBackVisible: false }} />
        <Stack.Screen name="scan" options={{ title: 'Scan the code', presentation: 'modal' }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="browser/[botId]" options={{ title: 'Browser' }} />
        {/* A sheet over the chat that stops halfway, and goes up the whole way when pulled or scrolled. */}
        <Stack.Screen name="model/[botId]" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [0.62, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.card } }} />
      </Stack>
    </ThemeProvider>
  )
}
