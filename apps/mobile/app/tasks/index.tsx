// Every scheduled task of every bot: the phone's version of the computer's Scheduled tasks page,
// reached from the bottom of the list of bots (as from the bottom of the computer's sidebar) and
// from Settings. Each opens to its runs and a form to change it; + makes a new one.
import { Alert, Switch, Text } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import type { ScheduledTask } from '@openbot/shared'
import { api, useStore } from '@openbot/client/store'
import { localZone, scheduleLabel, standing, trouble } from '@openbot/client/tasks'
import { useSession } from '../../src/session'
import { Avatar, Note, Row, Section, SettingsPage } from '../../src/SettingsUi'
import { useTheme } from '../../src/theme'

export default function Tasks() {
  const router = useRouter()
  const { server } = useSession()
  const tasks = useStore((s) => s.tasks)
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const main = bots.length > 1 ? bots[0] : undefined
  // What runs soonest first; what will not run again last.
  const sorted = [...tasks].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.title.localeCompare(b.title))

  return (
    <SettingsPage title="Scheduled tasks" subtitle={server?.name} buttons={1}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New task" disabled={!bots.length} onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: 'new' } })} />
      </Stack.Toolbar>

      <Section inset={60} footer={zone && zone !== localZone() ? `Times of day are kept in ${zone}, the time zone of the computer running Open Bot.` : undefined}>
        {sorted.map((task) => <TaskRow key={task.id} task={task} />)}
        {!sorted.length && <Row label="No scheduled tasks yet" detail="Tap + to make one, or ask a bot, for example “every weekday at 8, send me a short news brief”." />}
      </Section>

      <Note>
        A scheduled task gives a bot a prompt at set times. Each run happens in the background, beneath the bot’s conversation, and the bot tells you what came of it. Bots schedule tasks too, only for themselves, and change only the ones they made
        {main ? `. ${main.emoji} ${main.name}, the first bot, is the main assistant: it can schedule, change and delete tasks for every bot.` : '.'}
      </Note>
    </SettingsPage>
  )
}

function TaskRow({ task }: { task: ScheduledTask }) {
  const theme = useTheme()
  const router = useRouter()
  const bot = useStore((s) => s.bots.find((b) => b.id === task.botId))
  const zone = useStore((s) => s.about.timeZone)
  const problem = trouble(task)
  return (
    <Row
      leading={<Avatar emoji={bot?.emoji ?? '🤖'} />}
      label={task.title}
      detail={
        <>
          <Text style={{ color: theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{scheduleLabel(task.schedule, zone)} · {bot?.name ?? task.botId}</Text>
          <Text style={{ color: problem ? theme.err : task.lastStatus === 'running' ? theme.run : theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{task.lastStatus === 'running' ? 'Running now' : standing(task)}</Text>
        </>
      }
      onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
    >
      <Switch
        accessibilityLabel={`${task.title} is on`}
        value={task.enabled}
        trackColor={{ true: theme.ok }}
        onValueChange={(enabled) => api('PATCH', `/api/tasks/${task.id}`, { enabled }).catch((e) => Alert.alert('Not saved', (e as Error).message))}
      />
    </Row>
  )
}
