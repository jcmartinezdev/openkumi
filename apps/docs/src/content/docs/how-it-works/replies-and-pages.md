---
title: Replies and pages
description: "How replies are drawn, and the pages a bot can show in the conversation."
---

Replies are GitHub Markdown, drawn the same way in the desktop app and on the phone: code in
colour with its language and a copy button, tables that scroll sideways instead of squeezing,
diagrams from ```` ```mermaid ```` blocks (with their code a tap away), and formulas, written as
`$…$` within a line or as `$$…$$` on lines of their own. A dollar sign followed by a space or a
digit is a price, not a formula. A long run of steps between two messages is folded into one line
once it is over ("12 steps · 1m 04s").

When a picture says more than words, a bot calls `show_page` with a self-contained HTML page: a
chart, a dashboard, a timeline, a mockup. It appears in the conversation where the bot's reply is,
fitted to its height, and opens full size. The page is written against the app's colours as CSS
variables (`--foreground`, `--card`, `--chart-1` to `--chart-8`, chosen to stay apart for
colour-blind readers, and so on), so it follows light and dark mode. Pictures from the bot's
workspace are put into the page, so it keeps working when the files change. An ```` ```html ````
block in a reply can be previewed the same way.

A page runs in a frame that is a site of its own (`openkumi://page/` on the computer, a separate web
view on the phone). Its scripts run, and it may load scripts, styles, fonts and pictures from the
web (a chart library from a CDN), but it cannot reach the app or its keys, fetch or send anything,
or go to another site. Links in it open in your browser when you click them, and only then. On the
phone, Mermaid and KaTeX are loaded from jsDelivr when a diagram or formula is drawn.
