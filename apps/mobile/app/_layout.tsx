import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import * as SecureStore from 'expo-secure-store'
import { note, screen, wentWrong } from '@openkumi/client/telemetry'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router'
// Read first, so the app is light or dark as this phone was set to from the start.
import '../src/prefs'
import { AppTitle } from '../src/Alpha'
import { useUpdateChecks } from '../src/appUpdates'
import { CALL_BAR, CallBar, useCallBar } from '../src/CallBar'
// Gives the app its way of making calls.
import '../src/calls'
import { restore, useSession } from '../src/session'
import { useTelemetryQuestion } from '../src/Telemetry'
import { useAppearance, useTheme } from '../src/theme'

// What the app records about itself, for the server it is paired with to send if its owner agrees
// (@openkumi/client/telemetry): that it was opened, and what goes wrong in it.
const OPENED = 'openkumi.opened'
SecureStore.getItemAsync(OPENED)
  .then((before) => {
    note({ event: 'app opened', first: !before })
    if (!before) void SecureStore.setItemAsync(OPENED, '1')
  })
  .catch(() => note({ event: 'app opened', first: false }))
const handle = ErrorUtils.getGlobalHandler()
ErrorUtils.setGlobalHandler((error, fatal) => {
  wentWrong(error)
  handle(error, fatal)
})

/** Pages of settings rows, drawn on the grey of the phone's own Settings. */
const grouped = (route: string) => route.startsWith('settings/') || route.startsWith('automations/')

export default function Layout() {
  const theme = useTheme()
  const appearance = useAppearance()
  const { server, ready } = useSession()
  const router = useRouter()
  // Until there is a server the app is its welcome: the first screen, the pairing it leads to, and
  // the scanner that opens over that.
  const segments = useSegments() as string[]
  const welcoming = ['welcome', 'pair', 'scan'].includes(segments[0])
  // Which screen is showing, by the name of its route: "chat/[id]", never which chat.
  const showing = segments.join('/') || 'home'
  useEffect(() => {
    if (ready) screen(showing)
  }, [ready, showing])

  // A call under way has a bar across the top, under the title: every screen starts below it, so it covers nothing.
  const callBar = useCallBar() && !!server

  useEffect(() => void restore(), [])
  useUpdateChecks()
  useTelemetryQuestion()
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
          return { headerStyle: { backgroundColor: background }, headerTintColor: theme.text, headerShadowVisible: false, contentStyle: { backgroundColor: background, paddingTop: callBar ? CALL_BAR : 0 }, headerBackButtonDisplayMode: 'minimal', statusBarStyle }
        }}
      >
        {/* The title is still the name, for the menu of the back button; what shows is the name and that it is an alpha. */}
        <Stack.Screen name="index" options={{ title: 'OpenKumi', headerTitle: () => <AppTitle /> }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="pair" />
        <Stack.Screen name="scan" options={{ title: 'Scan the code', presentation: 'modal' }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="browser/[botId]" options={{ title: 'Browser' }} />
        {/* A call, over everything; pulled down it is put away, and the call goes on. */}
        <Stack.Screen name="call" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
        {/* A sheet over the chat that stops halfway, and goes up the whole way when pulled or scrolled. */}
        <Stack.Screen name="model/[botId]" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [0.62, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.card } }} />
        {/* Where a bot signs in to a superpower's app, and why one could not be reached: sheets over the superpower's page. */}
        <Stack.Screen name="superpowers/[botId]/[id]/sign-in" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: theme.group } }} />
        <Stack.Screen name="superpowers/[botId]/[id]/problem" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [0.45, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.card } }} />
        {/* The one question a server has for its owner (src/Telemetry.tsx), over the list of bots. */}
        <Stack.Screen name="telemetry" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: theme.group } }} />
        {/* A picture from a conversation, on black, whatever the app's appearance. */}
        <Stack.Screen name="picture" options={{ presentation: 'fullScreenModal', animation: 'fade', headerShown: false, statusBarStyle: 'light', contentStyle: { backgroundColor: '#000' } }} />
      </Stack>
      {/* A call under way, small, over whatever screen is showing. */}
      {!!server && <CallBar />}
    </ThemeProvider>
  )
}
