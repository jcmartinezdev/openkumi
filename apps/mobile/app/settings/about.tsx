// Which OpenKumi this is, on the phone and on the server it is paired with.
import { Linking } from 'react-native'
import Constants from 'expo-constants'
import { ALPHA_NOTE, ISSUES_URL } from '@openkumi/shared/alpha'
import { PRIVACY_POLICY_URL } from '@openkumi/shared/telemetry'
import { useStore } from '@openkumi/client/store'
import { useAppUpdate } from '../../src/appUpdates'
import { useSession } from '../../src/session'
import { Row, Section, SettingsPage } from '../../src/SettingsUi'

export default function About() {
  const { server } = useSession()
  const about = useStore((s) => s.about)
  const update = useAppUpdate()
  return (
    <SettingsPage title="About">
      <Section title="Alpha" footer={ALPHA_NOTE}>
        <Row label="Report a problem" tone="action" accessibilityHint="Opens OpenKumi’s issues on GitHub" onPress={() => void Linking.openURL(ISSUES_URL)} />
      </Section>

      <Section title="This phone" footer={update ? 'Most updates arrive by themselves and are used the next time the app starts. Bigger ones come as a new version, through TestFlight.' : undefined}>
        <Row label="OpenKumi for iPhone" value={Constants.expoConfig?.version ?? ''} />
        {update?.state === 'ready' ? (
          <Row label="Restart to update" detail="An update is downloaded." tone="action" onPress={update.restart} />
        ) : update ? (
          <Row
            label={update.state === 'downloading' ? 'Downloading an update…' : update.state === 'checking' ? 'Looking for an update…' : 'Check for updates'}
            detail={update.published ? `Last update ${update.published.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : undefined}
            tone="action"
            disabled={update.state !== 'current'}
            onPress={update.check}
          />
        ) : null}
      </Section>

      {!!about.version && (
        <Section title={server?.name}>
          <Row label="OpenKumi" value={about.version} />
          <Row label="Runs with" value={`Node.js ${about.node.replace(/^v/, '')} on ${about.platform}`} />
          {!!about.timeZone && <Row label="Time zone" value={about.timeZone} />}
        </Section>
      )}

      <Section footer="OpenKumi is open source.">
        <Row label="License" value="MIT" />
        <Row label="Privacy policy" tone="action" accessibilityHint="Opens OpenKumi’s privacy policy" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />
      </Section>
    </SettingsPage>
  )
}
