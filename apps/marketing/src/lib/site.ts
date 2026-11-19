// Where the website's links go.
export const SITE_NAME = 'OpenKumi'
export const TAGLINE = 'Your own crew of AI bots'
export const DESCRIPTION =
  'OpenKumi is a free, open-source desktop app for AI bots that live on your computer, each with its own memory, its own signed-in browser and only the powers you give it. Runs on the Claude, ChatGPT or Grok plan you already have.'

export const GITHUB_URL = 'https://github.com/jcmartinezdev/openkumi'
/** The documentation, a site of its own (apps/docs). */
export const DOCS_URL = 'https://docs.openkumi.ai'
/** The newest release: every installer, for people who want another than the one the button gives. */
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`
/**
 * The newest installer for a Mac, which has to be one with Apple silicon: OpenKumi is not made for
 * Intel Macs. Installers are named for what they run on and not for their version
 * (apps/desktop/scripts/dist.mjs), so this address always gives the newest.
 */
export const DOWNLOAD_URL = `${RELEASES_URL}/download/OpenKumi-mac-arm64.dmg`
/** What installs the server on a Mac or Linux computer that runs the bots with no app in front of it (public/install.sh). */
export const INSTALL_COMMAND = 'curl -fsSL https://openkumi.ai/install.sh | sh'

/** The address of one of the newest release's files. */
const file = (name: string) => `${RELEASES_URL}/download/${name}`

/**
 * The desktop app for each system, as the release names its installers. The first of each is the
 * one most people with that system need, and is what the page's main button gives them.
 * `usedByPeople` is false where the app has so far only been tried by the release's own check
 * (apps/desktop/scripts/try.mjs): the page says so. Set it once someone uses it there.
 */
export const DOWNLOADS = [
  {
    id: 'mac',
    name: 'Mac',
    needs: 'Apple silicon, macOS 12 or later',
    usedByPeople: true,
    files: [{ label: 'Apple silicon', href: file('OpenKumi-mac-arm64.dmg') }],
  },
  {
    id: 'windows',
    name: 'Windows',
    needs: 'Windows 10 or later',
    usedByPeople: false,
    files: [{ label: '64-bit', href: file('OpenKumi-win-x64.exe') }],
  },
  {
    id: 'linux',
    name: 'Linux',
    needs: 'An AppImage, which runs as it is',
    usedByPeople: false,
    files: [
      { label: 'x64', href: file('OpenKumi-linux-x86_64.AppImage') },
      { label: 'ARM', href: file('OpenKumi-linux-arm64.AppImage') },
    ],
  },
] as const
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`
/** Where to say what went wrong, which matters while OpenKumi is an alpha. */
export const ISSUES_URL = `${GITHUB_URL}/issues`

export const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/#superpowers', label: 'Superpowers' },
  { href: '/#privacy', label: 'Privacy' },
  { href: '/#faq', label: 'FAQ' },
  { href: DOCS_URL, label: 'Docs' },
]

/**
 * The company behind OpenKumi's website, its TestFlight beta and its usage reports, as its own
 * imprint and privacy pages give it (gotolcs.com). The imprint and the privacy policy say it.
 */
export const COMPANY = {
  name: 'goto LCS UG (haftungsbeschränkt)',
  address: ['Paul-Heyse-Straße 31 b', '80336 München', 'Germany'],
  director: 'Juan Cruz Martinez',
  /** For privacy questions and anything else. */
  email: 'contact@gotolcs.com',
  /** Where TestFlight testers send feedback (apps/mobile/scripts/testflight.mjs). */
  support: 'support@gotolcs.com',
  register: 'Amtsgericht München, HRB 259655',
  vat: 'DE335066751',
} as const
