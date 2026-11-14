// Every automation of every bot: the phone's version of the computer's Automations page,
// reached from the bottom of the list of bots (as from the bottom of the computer's sidebar) and
// from Settings. Each opens to its runs and a form to change it; + makes a new one.
import { Alert, Switch, Text } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import type { Automation } from '@openkumi/shared'
import { api, useStore } from '@openkumi/client/store'
import { localZone, standing, triggerLabel, trouble } from '@openkumi/client/automations'
import { useSession } from '../../src/session'
import { Avatar, Note, Row, Section, SettingsPage } from '../../src/SettingsUi'
import { useTheme } from '../../src/theme'

export default function Automations() {
  const router = useRouter()
  const { server } = useSession()
  const automations = useStore((s) => s.automations)
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const main = bots.length > 1 ? bots[0] : undefined
  // What runs soonest first; what will not run again last.
  const sorted = [...automations].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.title.localeCompare(b.title))

  return (
    <SettingsPage title="Automations" subtitle={server?.name} buttons={1}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New automation" disabled={!bots.length} onPress={() => router.push({ pathname: '/automations/[id]', params: { id: 'new' } })} />
      </Stack.Toolbar>

      <Section inset={60} footer={zone && zone !== localZone() ? `Times of day are kept in ${zone}, the time zone of the computer running OpenKumi.` : undefined}>
        {sorted.map((automation) => <AutomationRow key={automation.id} automation={automation} />)}
        {!sorted.length && <Row label="No automations yet" detail="Tap + to make one, or ask a bot, for example “every weekday at 8, send me a short news brief” or “tell me when this page changes”." />}
      </Section>

      <Note>
        An automation gives a bot a prompt without you asking: at set times, or when something it watches changes. Each run happens in the background, beneath the bot’s conversation, and the bot tells you what came of it. Bots make automations too, only for themselves, and change only the ones they made
        {main ? `. ${main.emoji} ${main.name}, the first bot, is the main assistant: it can make, change and delete automations for every bot.` : '.'}
      </Note>
    </SettingsPage>
  )
}

function AutomationRow({ automation }: { automation: Automation }) {
  const theme = useTheme()
  const router = useRouter()
  const bot = useStore((s) => s.bots.find((b) => b.id === automation.botId))
  const zone = useStore((s) => s.about.timeZone)
  const problem = trouble(automation)
  return (
    <Row
      leading={<Avatar bot={bot} />}
      label={automation.title}
      detail={
        <>
          <Text style={{ color: theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{triggerLabel(automation.trigger, zone)} · {bot?.name ?? automation.botId}</Text>
          <Text style={{ color: problem ? theme.err : automation.lastStatus === 'running' ? theme.run : theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{automation.lastStatus === 'running' ? 'Running now' : standing(automation)}</Text>
        </>
      }
      onPress={() => router.push({ pathname: '/automations/[id]', params: { id: automation.id } })}
    >
      <Switch
        accessibilityLabel={`${automation.title} is on`}
        value={automation.enabled}
        trackColor={{ true: theme.ok }}
        onValueChange={(enabled) => api('PATCH', `/api/automations/${automation.id}`, { enabled }).catch((e) => Alert.alert('Not saved', (e as Error).message))}
      />
    </Row>
  )
}
