// Which Open Bot this is, on the phone and on the server it is paired with.
import Constants from 'expo-constants'
import { useStore } from '@openbot/client/store'
import { useSession } from '../../src/session'
import { Row, Section, SettingsPage } from '../../src/SettingsUi'

export default function About() {
  const { server } = useSession()
  const about = useStore((s) => s.about)
  return (
    <SettingsPage title="About">
      <Section title="This phone">
        <Row label="Open Bot for iPhone" value={Constants.expoConfig?.version ?? ''} />
      </Section>

      {!!about.version && (
        <Section title={server?.name}>
          <Row label="Open Bot" value={about.version} />
          <Row label="Runs with" value={`Node.js ${about.node.replace(/^v/, '')} on ${about.platform}`} />
          {!!about.timeZone && <Row label="Time zone" value={about.timeZone} />}
        </Section>
      )}

      <Section footer="Open Bot is open source.">
        <Row label="License" value="MIT" />
      </Section>
    </SettingsPage>
  )
}
