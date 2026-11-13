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
  // Until there is a server the app is its welcome: the first screen, the pairing it leads to, and
  // the scanner that opens over that.
  const welcoming = ['welcome', 'pair', 'scan'].includes(useSegments()[0])

  useEffect(() => void restore(), [])
  // Once paired the welcome is left, and once unpaired it is back. Either way the app starts over,
  // with nothing left behind to go back to.
  useEffect(() => {
    if (!ready || (server ? !welcoming : welcoming)) return
    if (router.canDismiss()) router.dismissAll()
    router.replace(server ? '/' : '/welcome')
  }, [ready, server, welcoming])

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
        <Stack.Screen name="index" options={{ title: 'OpenKumi' }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="pair" />
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
