// Writes the page of the docs that says what a server tells OpenKumi's makers
// (src/content/docs/telemetry.md) from the list the server itself goes by
// (apps/server/src/telemetry-events.ts), so the page cannot say one thing and the server do another.
//   node apps/docs/scripts/telemetry.mjs
// A test of the server (apps/server/test/telemetry.test.mjs) fails when the page is not what this writes.
import fs from 'node:fs'
import path from 'node:path'
import { ALWAYS, EVENTS, FROM_APP } from '../../server/src/telemetry-events.ts'

export const PAGE = path.resolve(import.meta.dirname, '../src/content/docs/telemetry.md')

const KINDS = {
  count: 'A whole number',
  flag: 'Yes or no',
  version: 'A version, such as `0.0.1`',
  name: 'A name from OpenKumi’s own code or catalog',
  names: 'A list of names from OpenKumi’s own code or catalog',
}
const kind = (is) => (typeof is === 'string' ? KINDS[is] : `One of ${is.map((choice) => `\`${choice}\``).join(', ')}`)
const table = (carries) => ['| Name | What it can be | What it says |', '| --- | --- | --- |', ...Object.entries(carries).map(([name, { is, what }]) => `| \`${name}\` | ${kind(is)} | ${what} |`)].join('\n')
/** PostHog's own name for an error is "$exception". */
const title = (event) => (event === '$exception' ? 'error (`$exception`)' : event)

export function page() {
  const events = (fromApp) =>
    Object.entries(EVENTS)
      .filter(([, spec]) => (spec.from === 'app') === fromApp)
      .map(([event, { when, carries }]) => `### ${title(event)}\n\n${when}${Object.keys(carries).length ? `\n\n${table(carries)}` : ' It carries nothing of its own.'}`)
      .join('\n\n')
  return `---
title: Usage and error reports
description: "What OpenKumi tells the people who make it, what it never does, and how to switch it off."
---

<!-- Written by apps/docs/scripts/telemetry.mjs from apps/server/src/telemetry-events.ts. Change it there, then run the script. -->

OpenKumi keeps your bots, their files and everything you say to them on your own computer. There is
one thing it asks to send to the people who make it: how it is used, and where it breaks. This page
says all of what that is.

## The short of it

- **You are asked first.** The first time an app connects to a computer that runs your bots, it asks
  whether that computer may send this. The box is ticked; nothing is sent until you have answered,
  and a no means nothing is ever sent.
- **Only the computer that runs your bots sends anything.** The desktop app and the phone app
  record a little about themselves (that they were opened, which screens, never what a screen
  shows) and hand it to that computer, which checks it and sends it under the same answer. They
  send nothing themselves, and nothing at all while they have no computer to hand it to.
- **Never what you or your bots write.** No message, no file, no name of a bot, a file or an
  automation, no address, no sign-in, and nothing from a bot's browser. What can be sent is the list
  at the end of this page, and each value is checked against that list before it leaves.
- **A random id, not you.** Each computer that agrees gets a random id, so that what it sends can be
  told apart from what another sends. It is not made from anything about you or the computer.
  Where several people have bots on one computer, each one's server is asked, answers and has an
  id on its own.
- **It goes to PostHog**, a company that stores this kind of data, on its servers in the EU, which
  is set not to keep the address it came from. It is sent to \`pulse.openkumi.ai\`, an address of
  OpenKumi's that PostHog answers at.

## Switching it on or off

- In the app: **Settings → Privacy**. It is a setting of the server that runs your bots, so it is
  the same from every app that uses it.
- On a computer without the app: \`openkumi telemetry on\` or \`openkumi telemetry off\`. Without
  either word it says how things stand. \`--for <name>\` after it is about someone else's server
  there.
- Where the server is started: \`OPENKUMI_TELEMETRY=0\` or \`DO_NOT_TRACK=1\` in its environment
  switches it off whatever the setting says, and the apps then do not ask.

Switching it off throws the id away and drops whatever had not been sent yet. Switched on again,
the computer starts over with a new id. A server run from the source code sends nothing at all.

## Reading what was sent

**Settings → Privacy** lists each thing that was sent, exactly as it went, and shows the id, with a
button for a new one. The same list is kept in \`logs/telemetry.ndjson\` in the data folder, a line per
event, for the last few hundred.

## Errors

When something goes wrong in the server, what is sent is the kind of error (such as \`TypeError\`)
and the trail through OpenKumi's own code that led to it: file, function and line, as they are in
the public source. The error's message is never sent, since a message can hold a path, an address
or something you wrote, and neither is any step of the trail outside OpenKumi's code. An error
that keeps happening is sent at most ten times a day. A crash is written down as the server ends
and sent the next time it starts.

For something that goes wrong in the desktop app or the phone app, less is sent: the kind of error
and where in the app's own program it happened, as a file, a line and a column.

## Everything that can be sent

### With every event

${table(ALWAYS)}

PostHog also notes when each event arrived and, from the address it came from, the country. The
address itself is not kept.

## What the server records

${events(false)}

## What the apps record

These are recorded by the desktop app or the phone app, and handed to the computer that runs your
bots to send. Each also carries which app it came from:

${table(FROM_APP)}

${events(true)}
`
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  fs.writeFileSync(PAGE, page())
  console.log(`Wrote ${path.relative(process.cwd(), PAGE)}`)
}
