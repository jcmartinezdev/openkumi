// Puts a build of the iPhone app in front of the people testing it, through App Store Connect.
// Expo builds the app and uploads it to TestFlight (eas build --auto-submit), where the team gets
// it at once. Everyone else joins the group "Public beta" by its public link, and a build only
// reaches them once it is in that group and Apple's beta review has passed it. Expo cannot do
// either, so this does.
//
//   node scripts/testflight.mjs send 0.0.3            the build of 0.0.3: waits until Apple has
//                                                      processed it, says what to test, adds it to
//                                                      the group and sends it to beta review
//   node scripts/testflight.mjs send 0.0.3 --wait 75  waits up to 75 minutes for the build to show
//   node scripts/testflight.mjs send 0.0.3 --hold     all but sending it to review, for trying the
//                                                      build on your own phone first
//   node scripts/testflight.mjs texts                 sends the words testers and the reviewer read
//                                                      (testflight/*.txt) to App Store Connect
//
// It signs in with the App Store Connect key the release uses, from the same variables Expo reads:
// EXPO_ASC_API_KEY_PATH (the .p8 file), EXPO_ASC_KEY_ID and EXPO_ASC_ISSUER_ID. For `texts`, the
// feedback address and the reviewer's contact come from the environment too, since a phone number
// does not belong in the repository: TESTFLIGHT_FEEDBACK_EMAIL, and TESTFLIGHT_CONTACT_FIRST_NAME,
// _LAST_NAME, _EMAIL and _PHONE. Leave out any that are already set in App Store Connect.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.join(HERE, '..')
const APP = JSON.parse(fs.readFileSync(path.join(MOBILE, 'eas.json'), 'utf8')).submit.production.ios.ascAppId
/** The group the public link belongs to. */
const GROUP = 'Public beta'
const LOCALE = 'en-US'
const WEBSITE = 'https://openkumi.ai'
const PRIVACY = 'https://openkumi.ai/privacy'
const RELEASES = 'https://github.com/jcmartinezdev/openkumi/releases/tag'
const ISSUES = 'https://github.com/jcmartinezdev/openkumi/issues'

const stop = (message) => {
  console.error(`testflight: ${message}`)
  process.exit(1)
}
/** A line for the summary of the GitHub Actions run, when there is one, and for the log. */
const say = (line) => {
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
}

// ---- App Store Connect

const keyId = process.env.EXPO_ASC_KEY_ID
const issuer = process.env.EXPO_ASC_ISSUER_ID
let key

/** A token App Store Connect accepts for 20 minutes; a new one is made for each request. */
function token() {
  if (!key) {
    if (!process.env.EXPO_ASC_API_KEY_PATH || !keyId || !issuer) stop('EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID and EXPO_ASC_ISSUER_ID have to say which App Store Connect key to use.')
    key = fs.readFileSync(process.env.EXPO_ASC_API_KEY_PATH, 'utf8')
  }
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = `${part({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${part({ iss: issuer, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`
  return `${head}.${crypto.sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

async function asc(method, route, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${route}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const why = (json.errors ?? []).map((e) => e.detail || e.title).join(' ') || res.statusText
    const error = new Error(`App Store Connect said ${res.status} to ${method} ${route.split('?')[0]}: ${why}`)
    error.status = res.status
    throw error
  }
  return json
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const read = (name) => fs.readFileSync(path.join(MOBILE, 'testflight', name), 'utf8').trim()

// ---- send: one version's build, to the public group and beta review

/** The newest build of a version, once Apple has finished processing it. */
async function processedBuild(version, minutes) {
  const until = Date.now() + minutes * 60_000
  let said = ''
  for (;;) {
    const { data } = await asc('GET', `/v1/builds?filter[app]=${APP}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&sort=-uploadedDate&limit=1&fields[builds]=version,processingState`)
    const build = data[0]
    const state = build?.attributes.processingState
    if (state === 'VALID') return build
    if (state === 'FAILED' || state === 'INVALID') stop(`Apple could not process build ${build.attributes.version} of ${version} (${state}). App Store Connect says why, under TestFlight.`)
    const now = build ? `Build ${build.attributes.version} of ${version} is being processed by Apple.` : `No build of ${version} has reached App Store Connect yet.`
    if (now !== said) console.log(now)
    said = now
    if (Date.now() > until) stop(`${now} Gave up after ${minutes} minutes; once it is there, run: node apps/mobile/scripts/testflight.mjs send ${version}`)
    await sleep(30_000)
  }
}

async function send(version, minutes, hold) {
  const build = await processedBuild(version, minutes)
  const number = build.attributes.version

  // What to test, which TestFlight shows with the build.
  const whatsNew = `OpenKumi ${version}. What is new: ${RELEASES}/v${version}\n\nSomething not working? Take a screenshot to send feedback through TestFlight, or open an issue: ${ISSUES}`
  const { data: texts } = await asc('GET', `/v1/builds/${build.id}/betaBuildLocalizations`)
  const text = texts.find((t) => t.attributes.locale === LOCALE)
  if (text) await asc('PATCH', `/v1/betaBuildLocalizations/${text.id}`, { data: { type: 'betaBuildLocalizations', id: text.id, attributes: { whatsNew } } })
  else await asc('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: LOCALE, whatsNew }, relationships: { build: { data: { type: 'builds', id: build.id } } } } })

  // Into the group the public link belongs to. Testers are told once review has passed it.
  const { data: groups } = await asc('GET', `/v1/betaGroups?filter[app]=${APP}&filter[name]=${encodeURIComponent(GROUP)}&fields[betaGroups]=name,publicLink`)
  const group = groups.find((g) => g.attributes.name === GROUP)
  if (!group) stop(`There is no TestFlight group named "${GROUP}" for the app. It holds the public link; make it again in App Store Connect, under TestFlight.`)
  await asc('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] })

  // To beta review, unless it is there already or was passed (a later build of a version Apple
  // has seen can be passed without one).
  const { data: detail } = await asc('GET', `/v1/builds/${build.id}/buildBetaDetail`)
  const state = detail.attributes.externalBuildState
  if (state === 'READY_FOR_BETA_SUBMISSION' && hold) {
    say(`:pause_button: Build ${number} of ${version} is in "${GROUP}", not yet sent to beta review. To send it: node apps/mobile/scripts/testflight.mjs send ${version}`)
  } else if (state === 'READY_FOR_BETA_SUBMISSION') {
    await asc('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } })
    say(`:inbox_tray: Build ${number} of ${version} is in "${GROUP}" and was sent to Apple's beta review. Its testers get it once Apple passes it, usually within a day (${group.attributes.publicLink ?? 'no public link yet'}).`)
  } else {
    say(`:inbox_tray: Build ${number} of ${version} is in "${GROUP}"; its beta review state is ${state} (${group.attributes.publicLink ?? 'no public link yet'}).`)
  }
}

// ---- texts: what testers and the reviewer read

async function texts() {
  const description = read('description.txt')
  const notes = read('review-notes.txt')

  const app = { feedbackEmail: process.env.TESTFLIGHT_FEEDBACK_EMAIL, description, marketingUrl: WEBSITE, privacyPolicyUrl: PRIVACY }
  for (const name of Object.keys(app)) if (!app[name]) delete app[name]
  const { data: found } = await asc('GET', `/v1/betaAppLocalizations?filter[app]=${APP}&filter[locale]=${LOCALE}`)
  if (found[0]) await asc('PATCH', `/v1/betaAppLocalizations/${found[0].id}`, { data: { type: 'betaAppLocalizations', id: found[0].id, attributes: app } })
  else await asc('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale: LOCALE, ...app }, relationships: { app: { data: { type: 'apps', id: APP } } } } })
  say(`What testers read was sent${app.feedbackEmail ? ', with the feedback address' : ''}.`)

  const review = {
    notes,
    demoAccountRequired: false,
    contactFirstName: process.env.TESTFLIGHT_CONTACT_FIRST_NAME,
    contactLastName: process.env.TESTFLIGHT_CONTACT_LAST_NAME,
    contactEmail: process.env.TESTFLIGHT_CONTACT_EMAIL,
    contactPhone: process.env.TESTFLIGHT_CONTACT_PHONE,
  }
  for (const name of Object.keys(review)) if (review[name] === undefined || review[name] === '') delete review[name]
  try {
    await asc('PATCH', `/v1/betaAppReviewDetails/${APP}`, { data: { type: 'betaAppReviewDetails', id: APP, attributes: review } })
    say('What the reviewer reads was sent.')
  } catch (error) {
    if (error.status !== 409) throw error
    stop(`${error.message}\nApple wants the reviewer's contact with the notes: set TESTFLIGHT_CONTACT_FIRST_NAME, _LAST_NAME, _EMAIL and _PHONE.`)
  }
}

// ----

const [command, version, ...rest] = process.argv.slice(2)
const at = rest.indexOf('--wait')
const wait = at === -1 ? 0 : Number(rest[at + 1])
const hold = rest.includes('--hold')
const known = rest.every((arg, i) => arg === '--hold' || arg === '--wait' || (i === at + 1 && at !== -1))
if (command === 'send' && /^\d+\.\d+\.\d+$/.test(version ?? '') && Number.isFinite(wait) && wait >= 0 && known) await send(version, wait, hold)
else if (command === 'texts' && !version) await texts()
else stop('use it as "send <version> [--wait <minutes>] [--hold]" or "texts".')
