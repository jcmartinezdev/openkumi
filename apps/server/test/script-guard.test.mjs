// A bot's own script is run with a line in front of it that stops it unless the page is on the
// site that was checked (onlyOn, in tools.ts): where a page is was asked a moment before, and it
// can have gone on to another site since. That moment cannot be arranged in a test, so the line
// is tried here on its own, in a real Chrome: on a page of another site nothing of the script
// runs, whatever the script declares, and on the site itself it runs as it always did.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright-core'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-guard-'))
process.env.OPENKUMI_HOME = home
const { onlyOn } = await import('../src/tools.ts')

const server = http.createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>page</title><input value="held in the page">'))
let browser
let page
/** The site that was checked, and the same computer under another name: where the page has gone meanwhile. */
let checked
let elsewhere

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  checked = `127.0.0.1:${server.address().port}`
  elsewhere = `localhost:${server.address().port}`
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }))
  page = await browser.newPage()
})
after(async () => {
  await browser?.close()
  server.close()
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('on a page of another site nothing of a bot’s script runs, whatever it declares', async () => {
  await page.goto(`http://${elsewhere}/`)
  const ran = 'document.title = "RAN " + document.querySelector("input").value'
  const scripts = [
    ran,
    // What the line in front might have called, had it called anything.
    `function Error() { ${ran} }\n"done"`,
    `function String() { ${ran} }\nfunction JSON() { ${ran} }\n"done"`,
    `var Error = function () { ${ran} }; "done"`,
    // What it reads, given another meaning: the whole script stops before its first line.
    `function location() {}\n${ran}`,
    `let location = { host: ${JSON.stringify(checked)} }\n${ran}`,
    `class location { static host = ${JSON.stringify(checked)} }\n${ran}`,
    `var location = { host: ${JSON.stringify(checked)} }\n${ran}`,
    // Closing something that is not open, to step out of the check.
    `}; ${ran}; {`,
    `(async () => { ${ran} })()`,
  ]
  for (const script of scripts) {
    await page.evaluate('document.title = "page"')
    const outcome = await page.evaluate(onlyOn(checked, script, 'moved-word')).then(() => 'ran', (e) => String(e.message))
    assert.notEqual(outcome, 'ran', script)
    assert.equal(await page.title(), 'page', script)
  }
  // Where it stopped because the page is elsewhere, that is what it says, for the bot to be told so.
  assert.match(await page.evaluate(onlyOn(checked, ran, 'moved-word')).catch((e) => String(e.message)), /moved-word/)
  assert.match(await page.evaluate(onlyOn(checked, `function Error() { ${ran} }\n1`, 'moved-word')).catch((e) => String(e.message)), /moved-word/)
})

test('on the site that was checked a script runs as it always did', async () => {
  await page.goto(`http://${checked}/`)
  assert.equal(await page.evaluate(onlyOn(checked, 'document.querySelector("input").value', 'moved-word')), 'held in the page')
  assert.equal(await page.evaluate(onlyOn(checked, '1 + 1', 'moved-word')), 2)
  assert.deepEqual(await page.evaluate(onlyOn(checked, '({ a: [1, 2] })', 'moved-word')), { a: [1, 2] })
  assert.equal(await page.evaluate(onlyOn(checked, 'new Promise((done) => setTimeout(() => done("later"), 10))', 'moved-word')), 'later')
  assert.equal(await page.evaluate(onlyOn(checked, 'const n = 3; n * 2', 'moved-word')), 6)
  await page.evaluate(onlyOn(checked, 'document.title = "changed"', 'moved-word'))
  assert.equal(await page.title(), 'changed')
})
