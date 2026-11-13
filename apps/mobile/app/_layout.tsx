import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router'
// Read first, so the app is light or dark as this phone was set to from the start.
import '../src/prefs'
import { restore, useSession } from '../src/session'
import { useAppearance, useTheme } from '../src/theme'

/** Pages of settings rows, drawn on the grey of the phone's own Settings. */
const grouped = (route: string) => route.startsWith('settings/') || route.startsWith('tasks/')

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
      <Stack
        screenOptions={({ route }) => {
          const background = grouped(route.name) ? theme.group : theme.bg
          // Said outright: each screen sets the status bar, and would go by the phone's setting rather than the app's.
          const statusBarStyle = appearance === 'dark' ? 'light' : 'dark'
          return { headerStyle: { backgroundColor: background }, headerTintColor: theme.text, headerShadowVisible: false, contentStyle: { backgroundColor: background }, headerBackButtonDisplayMode: 'minimal', statusBarStyle }
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Open Bot' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair with your computer', headerBackVisible: false }} />
        <Stack.Screen name="scan" options={{ title: 'Scan the code', presentation: 'modal' }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="browser/[botId]" options={{ title: 'Browser' }} />
        {/* A sheet over the chat that stops halfway, and goes up the whole way when pulled or scrolled. */}
        <Stack.Screen name="model/[botId]" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [0.62, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.card } }} />
        {/* A picture from a conversation, on black, whatever the app's appearance. */}
        <Stack.Screen name="picture" options={{ presentation: 'fullScreenModal', animation: 'fade', headerShown: false, statusBarStyle: 'light', contentStyle: { backgroundColor: '#000' } }} />
      </Stack>
    </ThemeProvider>
  )
}
