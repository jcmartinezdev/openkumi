// How the desktop and phone apps put the one question a server has for its owner: whether it may
// tell OpenKumi's makers how it is used and what goes wrong (apps/server/src/telemetry.ts). Both
// apps ask it in these words, and say the same on their Privacy page.

export const TELEMETRY_TITLE = 'Help make OpenKumi better'

/** What is being asked, and why. */
export const TELEMETRY_ASK =
  'OpenKumi is new, and the people who make it cannot see how it is used or where it breaks. If you agree, the computer that runs your bots tells them.'

/** What goes and what never does, as short lines. */
export const TELEMETRY_SENT = ['Which features are used, and how often.', 'Where in OpenKumi’s own code something went wrong.', 'The version of OpenKumi, and the kind of computer it runs on.']
export const TELEMETRY_NEVER = ['What you or your bots write, say or read.', 'The names of your bots, files and automations.', 'Addresses, sign-ins, or anything from a bot’s browser.']

/** Where it goes and how it can be undone. */
export const TELEMETRY_HOW = 'It goes to PostHog, in the EU, under a random id for that computer. You can switch it off at any time in Settings, under Privacy, which also shows everything that was sent.'

/** The box, which is ticked when the question is asked. */
export const TELEMETRY_CHOICE = 'Send how OpenKumi is used and what goes wrong'

/** Everything that can be sent, event by event. */
export const TELEMETRY_URL = 'https://docs.openkumi.ai/telemetry/'

/** What OpenKumi and its website do with data (apps/marketing/src/pages/privacy). Apple wants it in the app too. */
export const PRIVACY_POLICY_URL = 'https://openkumi.ai/privacy'
