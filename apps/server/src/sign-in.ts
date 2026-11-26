// Signing a bot in to a site with one of its logins, without the model in between. The bot names
// the login (browser_sign_in); what is here finds the form on the page, fills in the user name and
// the password, sends it, and says how it went. The model never has the password, and has no part
// in where it is put: that is decided here, by what the page is and where it is.
//
// The same reading of a page is what notices a sign-in the owner does by hand, while they have
// control of a window, so that it can be offered to them to keep (see BotBrowser.noteTyped).
import type { ElementHandle, Frame, Page } from 'playwright-core'
import type { Login } from './secrets.ts'

type Want =
  /** The password field of a sign-in form. */
  | 'password'
  /** The user name field: the one that goes with the password field `from`, or without one, the field of a form that asks for the user name first. */
  | 'user'
  /** What sends the form the field `from` is in. */
  | 'submit'
  /** A box to tick to stay signed in, in the form of the field `from`, when it is not ticked. */
  | 'remember'
  /** Whether a password field is showing at all. */
  | 'shows'
  /** Whether Enter in the field `from` sends its form by itself: it is in a form with a button that sends it. */
  | 'formed'
  /** The addresses the form of the field `from` sends what is in it to, when the page says: its own, and those of its buttons. */
  | 'sends'
  /** What has been typed into the page's sign-in form. */
  | 'typed'

/**
 * Runs in a page. Everything that reads a sign-in form is in this one function, since a function
 * sent to a page takes nothing along from the file it was written in.
 */
function look({ want, from, value }: { want: Want; from?: Node | null; value?: string }): any {
  // Fields in the order they are on the page, those inside a component's own tree among them.
  const within = (root: Document | ShadowRoot, found: Element[] = []): Element[] => {
    for (const el of root.querySelectorAll('*')) {
      if (el.matches('input, button, [role=button]')) found.push(el)
      if (el.shadowRoot) within(el.shadowRoot, found)
    }
    return found
  }
  const everything = within(document)
  const fields = everything.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
  const seen = (el: Element) => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const usable = (el: HTMLInputElement) => seen(el) && !el.disabled && !el.readOnly
  // A card's security code and a one-time code are often password fields too, and are no password.
  const isPassword = (el: HTMLInputElement) => el.type === 'password' && usable(el) && !/cc-|one-time-code/.test(el.autocomplete) && !(el.maxLength > 0 && el.maxLength <= 4)
  const said = (el: HTMLInputElement) => [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label'), el.labels?.[0]?.textContent].join(' ').toLowerCase()
  const isSearch = (el: HTMLInputElement) => el.type === 'search' || el.getAttribute('role') === 'searchbox' || /search|query/.test(`${el.name} ${el.id}`.toLowerCase())
  // A password that is being shown is in a field that says text, and is no user name for that.
  const shownPassword = (el: HTMLInputElement) => /password/.test(el.autocomplete) || /pass|pwd/.test(`${el.name} ${el.id}`.toLowerCase())
  const texty = (el: HTMLInputElement) => ['text', 'email', 'tel'].includes(el.type) && usable(el) && !isSearch(el) && !shownPassword(el)
  const userLike = (el: HTMLInputElement) => texty(el) && (el.type === 'email' || /user|e-?mail|login|account|identifier|phone|mobile|benutzer|usuario|correo|utilisateur|courriel|identifiant/.test(said(el)))
  /** The user name field that goes with a password field: the nearest one before it, in its form. */
  const userBefore = (password: HTMLInputElement) => {
    const before = fields.slice(0, fields.indexOf(password)).filter((el) => texty(el) && el.form === password.form)
    return before.findLast(userLike) ?? before.at(-1) ?? null
  }
  /**
   * The field of a form that asks for the user name alone, and for the password on its next page.
   * A page has other fields that take an e-mail address (a newsletter's), so this one has to say
   * that it is a user name, or be on a page or in a form that says it signs in.
   */
  const userAlone = () => {
    const signsIn = /log-?in|sign-?in|signin|auth|sso|session|account|identifier/
    return (
      fields.find(
        (el) =>
          userLike(el) &&
          (/username|webauthn/.test(el.autocomplete) || /user|login|identifier|account/.test(`${el.name} ${el.id}`.toLowerCase()) || signsIn.test(`${location.pathname} ${el.form?.getAttribute('action') ?? ''} ${el.form?.id ?? ''}`.toLowerCase())),
      ) ?? null
    )
  }
  // A page that both signs in and signs up has a password field for each: the one for the password there is, is the one meant.
  const passwords = fields.filter(isPassword)
  const password = passwords.find((el) => /current-password/.test(el.autocomplete)) ?? passwords.find((el) => !/new-password/.test(el.autocomplete)) ?? passwords[0] ?? null

  if (want === 'password') return password
  // A password that is being shown is in a field that is no password field for as long as it is.
  if (want === 'shows') return fields.some((el) => seen(el) && (el.type === 'password' || (!!value && el.value === value)))
  if (want === 'user') return from instanceof HTMLInputElement ? userBefore(from) : password ? null : userAlone()
  if (want === 'typed') {
    // One password, or the same one twice (a new account, which asks for it again). Two that differ are a change of password, or a slip.
    const filled = fields.filter((el) => isPassword(el) && el.value)
    const one = new Set(filled.map((el) => el.value)).size === 1 ? filled[0] : null
    const user = one ? userBefore(one) : password ? null : userAlone()
    // Where it was typed is read with what was typed: a page that goes elsewhere in between is another page.
    return { password: one?.value ?? null, user: user?.value.trim() ?? '', host: location.host, page: `${location.origin}${location.pathname}` }
  }
  if (!(from instanceof HTMLInputElement)) return null
  const sending = (form: HTMLFormElement) => [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type=submit], input[type=submit], input[type=image], button:not([type])')].filter((el) => seen(el) && !el.disabled)
  if (want === 'formed') return !!from.form && sending(from.form).length > 0
  if (want === 'sends') {
    if (!from.form) return []
    // As the page wrote them: a field named "action" stands in the way of asking the form itself.
    const written = [from.form.getAttribute('action'), ...sending(from.form).map((el) => el.getAttribute('formaction'))].filter((address): address is string => !!address)
    return written.map((address) => { try { return new URL(address, document.baseURI).href } catch { return '' } })
  }
  if (want === 'remember') {
    const boxes = fields.filter((el) => el.type === 'checkbox' && el.form === from.form && !el.disabled && !el.checked)
    return boxes.find((el) => /remember|keep.{0,12}(signed|logged)|stay.{0,12}(signed|logged)|persist|angemeldet|recordar|recu[eé]rd|mantener|souvenir|rester|ricorda/.test(said(el))) ?? null
  }
  if (want === 'submit') {
    const own = from.form && sending(from.form)[0]
    if (own) return own
    // A form that is not written as one: the first button after the field that says it signs in, and not with somebody else's account.
    const says = (el: Element) => (el instanceof HTMLInputElement ? el.value : (el.textContent ?? '')).replace(/\s+/g, ' ').trim().toLowerCase()
    const after = everything.slice(everything.indexOf(from) + 1).filter((el) => !(el instanceof HTMLInputElement && !['button', 'submit'].includes(el.type)) && seen(el))
    return (
      after.find((el) => /^(sign in|log in|login|continue|next|submit|enter|anmelden|einloggen|weiter|iniciar sesi[oó]n|entrar|acceder|siguiente|continuar|se connecter|connexion|suivant|accedi|avanti)\b/.test(says(el)) && !/ with | mit | con | avec /.test(` ${says(el)} `)) ?? null
    )
  }
  return null
}

const hostOf = (frame: Frame) => {
  try {
    const url = new URL(frame.url())
    return /^https?:$/.test(url.protocol) ? url.host : null
  } catch {
    return null
  }
}

/** An element of a frame's page, if it has one such: the frame's own page comes first among a page's frames. */
async function element(frame: Frame, want: Want, from?: ElementHandle): Promise<ElementHandle<HTMLInputElement> | null> {
  const handle = await frame.evaluateHandle(look, { want, from: from ?? null }).catch(() => null)
  const found = handle?.asElement() ?? null
  if (!found) handle?.dispose().catch(() => {})
  return found as ElementHandle<HTMLInputElement> | null
}

/** Whether a password field is showing anywhere in a page. */
async function showsPassword(page: Page): Promise<boolean> {
  const shows = await Promise.all(page.frames().map((frame) => frame.evaluate(look, { want: 'shows' as Want }).catch(() => false)))
  return shows.some(Boolean)
}

async function until<T>(page: Page, check: () => Promise<T | null | false>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await check()
    if (found) return found
    if (Date.now() >= deadline || page.isClosed()) return null
    await page.waitForTimeout(250).catch(() => {})
  }
}

/**
 * Puts a value into a field itself, as if it had been typed: not typed at whatever has the focus,
 * which something else on the page (an advertisement in a frame of its own) could take in the
 * moment between. Says whether the field took it.
 */
export function put(field: ElementHandle, value: string): Promise<boolean> {
  return field
    .evaluate((el, value) => {
      const plain = ['text', 'password', 'email', 'search', 'tel', 'url', 'number']
      if (el instanceof HTMLInputElement && plain.includes(el.type) && !el.disabled && !el.readOnly) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
      else if (el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
      else if (el instanceof HTMLElement && el.isContentEditable) el.textContent = value
      else return false
      // A field that did not take it as it is (one for numbers, given letters) holds something else now, or nothing.
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value !== value) return false
      el.focus()
      // As if it had been typed: the page hears of it the way it hears of typing.
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, value)
    .catch(() => false)
}

/**
 * Sends the form a field is in: with Enter, as a person would, and when the page takes no notice
 * of that (a form that is not written as one), with the button that says it signs in.
 */
async function send(page: Page, field: ElementHandle<HTMLInputElement>) {
  const frame = await field.ownerFrame()
  const at = page.url()
  let left = false
  const leaving = (moved: Frame) => void (left ||= moved === frame || moved === page.mainFrame())
  page.on('framenavigated', leaving)
  try {
    // A form with a button that sends it is sent by Enter, however long its answer takes: the button would send it twice.
    const formed = !frame || (await frame.evaluate(look, { want: 'formed' as Want, from: field }).catch(() => false))
    await field.press('Enter', { timeout: 5000 }).catch(() => {})
    if (formed) return
    await page.waitForTimeout(1500).catch(() => {})
    // Still there, as it was: nothing took the Enter.
    const stayed = !left && page.url() === at && (await field.evaluate((el) => el.isConnected && el.value !== '').catch(() => false))
    if (!stayed || !frame) return
    const button = await element(frame, 'submit', field)
    await button?.click({ timeout: 3000 }).catch(() => {})
  } finally {
    page.off('framenavigated', leaving)
  }
}

export interface SignedIn {
  /** The form went away after it was sent. Not yet that the site let the bot in: it may ask for a code next. */
  went: boolean
}

/**
 * Signs in on `page` with a login. `password` gives the password for the page the form is on, or
 * refuses (it is not that login's site, or the bot's own script has run there): nothing is put
 * anywhere before it has said yes to where.
 */
export async function signIn(page: Page, login: Login, password: (where: URL) => Promise<string>): Promise<SignedIn> {
  const mine = (frame: Frame) => login.sites.includes(hostOf(frame) ?? '')
  /** The sign-in form on a page of the login's site: its password field, or the user name field of a form that asks for that first. */
  const form = async () => {
    for (const frame of page.frames().filter(mine)) {
      const field = await element(frame, 'password')
      if (field) return { frame, field, asks: 'password' as const }
    }
    for (const frame of page.frames().filter(mine)) {
      const field = await element(frame, 'user')
      if (field) return { frame, field, asks: 'user' as const }
    }
    return null
  }
  /** A site with a form on the page that this login is not for, to say so. */
  const elsewhere = async () => {
    for (const frame of page.frames().filter((frame) => !mine(frame) && hostOf(frame))) {
      if ((await element(frame, 'password')) || (await element(frame, 'user'))) return hostOf(frame)
    }
    return null
  }
  const notFor = (host: string) =>
    `The sign-in form here is on ${host}, and the login "${login.name}" is for ${login.sites.join(', ')}, so nothing was entered. If that is where this account signs in, the user can add ${host} to the login, in your settings under Secrets.`

  let found = await until(page, form, 4000)
  // No form here: the page the login was kept from is where there was one.
  if (!found && login.page && !page.url().startsWith(login.page) && !(await elsewhere())) {
    await page.goto(login.page, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    found = await until(page, form, 8000)
  }
  if (!found) {
    const other = await elsewhere()
    if (other) throw new Error(notFor(other))
    throw new Error(
      `No sign-in form was found on this page (${page.url().slice(0, 200)}). Open the page of ${login.sites[0]} that asks for the user name and password, then call browser_sign_in again. If you are signed in already, there is nothing to do.`,
    )
  }

  let field = found.field
  if (found.asks === 'user') {
    // A form that asks for the user name first, and for the password on what comes next.
    await field.fill(login.user, { timeout: 8000 })
    await send(page, field)
    const next = await until(page, async () => { const f = await form(); return f?.asks === 'password' && f }, 12_000)
    if (!next) {
      const other = await elsewhere()
      if (other) throw new Error(notFor(other))
      throw new Error(`The user name was entered, but the site did not ask for the password after it. Look at the page: it may not know this user name, or want something else first.`)
    }
    found = next
    field = next.field
  } else {
    const user = await element(found.frame, 'user', field)
    if (user && (await user.inputValue().catch(() => '')) !== login.user) await user.fill(login.user, { timeout: 8000 }).catch(() => {})
  }

  // The password goes into the field that was found, in the page whose address is checked here: if the page
  // goes elsewhere meanwhile, the field is gone and nothing is put anywhere.
  const frame = await field.ownerFrame()
  if (!frame) throw new Error('The sign-in form went away before it was filled in. Take a new snapshot.')
  // A form that says it sends what is in it to another site is not given the password, whatever page it is on.
  const sends: string[] = await frame.evaluate(look, { want: 'sends' as Want, from: field }).catch(() => [])
  const away = sends.map((address) => { try { return new URL(address) } catch { return null } }).find((to) => to && /^https?:$/.test(to.protocol) && !login.sites.includes(to.host))
  if (away) {
    throw new Error(
      `The sign-in form here sends what is typed into it to ${away.host}, and the login "${login.name}" is for ${login.sites.join(', ')}, so the password was not entered. If that is where this account signs in, the user can add ${away.host} to the login, in your settings under Secrets.`,
    )
  }
  if (!(await put(field, await password(new URL(frame.url()))))) throw new Error('The password could not be put into the form: its field is no longer on the page, or does not take text.')
  // Staying signed in is what a login is kept for.
  const remember = await element(frame, 'remember', field)
  await remember?.evaluate((el) => el.click()).catch(() => {})
  // A site that answers with a page of its own has answered once that page is there: if it asks for the
  // password again, it did not take it. One that answers within its page is given longer.
  let answered = 0
  const answering = (moved: Frame) => void (moved === page.mainFrame() && (answered = Date.now()))
  page.on('framenavigated', answering)
  try {
    await send(page, field)
    const deadline = Date.now() + 10_000
    let went = false
    while (!(went = !(await showsPassword(page))) && Date.now() < deadline && !page.isClosed()) {
      if (answered && Date.now() - answered > 2000) break
      await page.waitForTimeout(250).catch(() => {})
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(800).catch(() => {})
    return { went }
  } finally {
    page.off('framenavigated', answering)
  }
}

/** What has been typed into the sign-in form of one of a page's frames, and where: a password, or the user name of a form that asks for that first. */
export interface Typed {
  host: string
  page: string
  user: string
  password: string | null
}

/** Reads what is typed into a page's sign-in form, if it has one with something in it. */
export async function typedIn(page: Page): Promise<Typed | null> {
  const read = await Promise.all(
    page.frames().map(async (frame): Promise<Typed | null> => {
      const host = hostOf(frame)
      if (!host) return null
      const typed = await Promise.race([frame.evaluate(look, { want: 'typed' as Want }).catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), 500).unref())])
      return typed?.host && (typed.password || typed.user) ? typed : null
    }),
  )
  return read.find((typed) => typed?.password) ?? read.find(Boolean) ?? null
}

/** Whether a page still shows a password field, or still holds the password that was typed, on the site a sign-in was typed into. */
export async function stillAsks(page: Page, host: string, value: string): Promise<boolean> {
  const shows = await Promise.all(
    page
      .frames()
      .filter((frame) => hostOf(frame) === host)
      .map((frame) => frame.evaluate(look, { want: 'shows' as Want, value }).catch(() => false)),
  )
  return shows.some(Boolean)
}
