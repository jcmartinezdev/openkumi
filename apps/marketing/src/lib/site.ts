// Where the website's links go.
export const SITE_NAME = 'OpenKumi'
export const TAGLINE = 'Your own crew of AI bots'
export const DESCRIPTION =
  'OpenKumi is a free, open-source desktop app for AI bots that live on your computer, each with its own memory, its own signed-in browser and only the powers you give it. Runs on the Claude, ChatGPT or Grok plan you already have.'

export const GITHUB_URL = 'https://github.com/jcmartinezdev/openkumi'
/** The newest release: every installer, for people who want another than the one the button gives. */
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`
/**
 * The newest installer for a Mac with Apple silicon, which is what nearly every Mac sold since
 * 2020 has. Installers are named for what they run on and not for their version
 * (apps/desktop/scripts/dist.mjs), so this address always gives the newest.
 */
export const DOWNLOAD_URL = `${RELEASES_URL}/download/OpenKumi-mac-arm64.dmg`
/** What installs the server on a Mac or Linux computer that runs the bots with no app in front of it (public/install.sh). */
export const INSTALL_COMMAND = 'curl -fsSL https://openkumi.ai/install.sh | sh'
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`

export const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/#superpowers', label: 'Superpowers' },
  { href: '/#privacy', label: 'Privacy' },
  { href: '/#faq', label: 'FAQ' },
]
