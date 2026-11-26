---
title: Replies and pages
description: "How replies are drawn, the pages a bot can show in the conversation, and the frame those pages run in."
---

Replies are GitHub Markdown, drawn the same way in the desktop app and on the phone: code in
colour with its language and a copy button, tables that scroll sideways instead of squeezing,
diagrams from ```` ```mermaid ```` blocks (with their code a tap away), and formulas, written as
`$…$` within a line or as `$$…$$` on lines of their own. A dollar sign followed by a space or a
digit is a price, not a formula. A long run of steps between two messages is folded into one line
once it is over ("12 steps · 1m 04s").

## Pages

When a picture says more than words, a bot calls `show_page` with a self-contained HTML page (up
to 1 MB): a chart, a dashboard, a timeline, a mockup. It appears in the conversation where the
bot's reply is, fitted to its height, and opens full size.

- **It follows light and dark.** The page is written against the app's colours as CSS variables
  (`--foreground`, `--card`, `--chart-1` to `--chart-8`, chosen to stay apart for colour-blind
  readers, and so on).
- **It keeps working.** Pictures from the bot's workspace are put into the page itself when it is
  shown, so it keeps working when the files change or move.
- **Previews too.** An ```` ```html ```` block in a reply can be previewed the same way.
- **Pages to fill in.** A page saved as a file, or one a superpower brings (such as Game night's
  game page), can be shown with data: the bot gives an object, which is written into the page
  where its script reads it, along with when it was shown. The bot then sends a few lines of data
  for each step instead of a whole page.

## The frame a page runs in

A page is written by a bot, which may have read something written to mislead it, so a page is kept
away from everything that matters.

- **A site of its own.** On the computer, a page runs in a sandboxed frame at `openkumi://page/`,
  which is not the app's own address; on the phone, in a separate web view. It cannot reach the app,
  its keys, or the server.
- **It cannot make requests.** Its scripts run, but it cannot fetch anything, open a connection,
  send a form, or go to another site.
- **It may load from the web.** It may load scripts, styles, fonts, pictures and media from `https`
  addresses (a chart library from a CDN, say). Like any address, one it loads could carry something
  in it; a page only knows what the bot put into it, never your keys or your other conversations.
- **Links open in your browser** when you click them, and only then.

On the phone, Mermaid and KaTeX are loaded from jsDelivr when a diagram or formula is drawn.
