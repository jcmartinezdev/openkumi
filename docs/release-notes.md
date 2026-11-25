# Release notes

A release is published with GitHub's own list of its pull requests as the notes
(`--generate-notes` in `.github/workflows/release.yml`). Once **Publish the release** has run,
replace that list with notes written by hand, in the order below:

```sh
gh release edit v0.2.0 --notes-file notes.md
```

## The order

What changes for people using the bots and the apps comes first, and the most important of it
first. The website, the documentation and how OpenKumi is worked on are still named, but last,
in a line each.

1. **The summary**: a paragraph, with no heading over it.
2. **What's new**: new things in the bots and the apps, a short section each.
3. **Fixes**: what worked wrong in the bots and the apps and now works, a line each.
4. **Before you update**: only when people have to do something, or will notice something the
   first time they update.
5. **Also in this release**: the website, the documentation, working on OpenKumi, a line each.
6. Whether the data stays as it is, and the **Full Changelog** link.

## Sorting the changes

List what was merged since the last release with `git log --oneline v0.1.0..v0.2.0`, and sort
what each pull request changes by who it changes something for, not by the files it touches. One
pull request can bring a feature, a fix and a step people have to take, and then it is named in
each place:

| Place | What goes there |
| --- | --- |
| What's new | something a bot can now do, or something new in the server, the desktop app or the iPhone app (the installer included) |
| Fixes | something in the bots or the apps that worked wrong and now works, also when the fix came inside a feature's pull request, as long as people could have run into it |
| Before you update | what people have to do when they update, or will notice the first time: an address that stops working, data moved, the iPhone app coming through TestFlight |
| Also in this release | the website, openkumi.ai; the documentation, docs.openkumi.ai, when the change is not part of a feature; how OpenKumi is worked on, for people who build it |
| Left out | the version bump, and anything nobody using or working on OpenKumi would notice |

A feature's own changes to the documentation and the website go with the feature, not under
**Also in this release**.

In **What's new**, put first what people will notice most, whether it is in a bot, the server,
the desktop app or the iPhone app. Most often that means, in this order:

1. something a bot can do that it could not before, or a new way to reach the bots;
2. a change in what people see and use every day;
3. a setting, a menu item or a shortcut.

Two pull requests that make one feature share one section. A feature that is in the code but
switched off in the release (CarPlay, until Apple allows it) goes last, and its heading says it
is not on yet.

## The summary

The summary is what people read first, and often all they read. In three to five sentences:

- **the features**, the two or three that matter most, by what people can now do: "Your main
  assistant can now rename a bot or move it to another model when you ask", not "Adds
  `update_bot`";
- **the fixes** worth knowing, in one sentence, when there are any;
- **a pointer** to **Before you update**, in one sentence, when there is something to do.

No pull request numbers or links in it, and no website or documentation, unless the release is
only that.

## Writing a section

- The heading names what people get, in bold, with its pull requests: `**Put your bots in order** (#49)`.
- Below it, a paragraph: what it does, where it is in the app (**Settings → General → …**),
  what people need for it (a plan, a sign-in, the app open), and what it does not do yet.
- End with a link to the page on docs.openkumi.ai that covers it, when there is one, and check
  the anchor exists.
- Plain words about using it, not about how it is built.
- Credit someone outside the project with a link to their profile, not a bare `@handle`, which
  would notify whoever has that name on GitHub.

When the iPhone app comes through TestFlight instead of an update over the air, say so under
**Before you update**. A pull request with the **📱 Native change** label is the sign to look,
but what the release's iPhone job did decides it: a build for TestFlight, an update over the air,
or nothing yet (see [Releasing the iPhone app](mobile-releases.md)). Say
too whether the app people have keeps working with the new server until then: it does, unless
the release changed how the two talk (`packages/shared/src/protocol.ts`).

## Template

```markdown
OpenKumi 0.2.0 lets your bots … and … . On the iPhone, … . It also fixes … and … .
[If you …, read Before you update.]

## What's new

**What people get** (#00)
What it does, where it is, what it needs, what it does not do yet. [Docs page](https://docs.openkumi.ai/…)

**What people get** (#00, #00)
… [Docs page](https://docs.openkumi.ai/…)

## Fixes

- **Where it was:** what went wrong; now what happens. (#00)
- … (#00)

## Before you update

- **If you …**, … ([Docs page](https://docs.openkumi.ai/…)).
- **On the iPhone**, this version changes the app itself, so it comes as a new TestFlight build
  instead of an update over the air. The public beta gets it once Apple's beta review has passed
  it, usually within a day. [Until then, the app you have keeps working with the new server.]

## Also in this release

- **Website:** … (#00)
- **Documentation:** … (#00)
- **Working on OpenKumi:** … (#00)

Your data stays as it is: updating from 0.1.0 needs no step of its own.

**Full Changelog**: https://github.com/jcmartinezdev/openkumi/compare/v0.1.0...v0.2.0
```

Leave out a heading with nothing under it, and the parts in square brackets when they do not
hold. When updating changes the data, or does something once the first time (as 0.0.3 moved
everyone's data into a folder of their own), say what happens under **Before you update** instead
of the line about the data.
