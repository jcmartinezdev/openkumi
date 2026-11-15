---
title: "One app, several processes and threads"
description: "How the desktop app spreads its work over processes and a worker thread so that no part holds up another."
---

The app is not a web page in a window. Its work is spread out so that no part can hold up another:

| Where | What runs there |
| --- | --- |
| The app's main process | the window, the menu, the list of environments. It does no work of its own |
| A process of its own (`OpenKumi Server`) | the server, when the local environment is on. Each bot's Chrome, and each Claude Code or Codex turn, is a further process the server starts |
| The window | the interface, loaded from the app itself (`openkumi://app/`), talking straight to the environment it shows |
| A worker thread in the window | the connection to the environment: it reads what arrives, hands changes to the window at most once per frame, and draws the pictures of a bot's browser straight onto the page |
| A program of its own (`dictation`), while you dictate | listening, and writing down what is said, on the Mac; the app passes its words to the window |

Two things follow for speed. Text that streams in is collected on the worker and applied once per
frame, and a reply being written is drawn piece by piece, so only its last paragraph is worked out
again as it grows. Pictures of a bot's browser arrive as bytes and are decoded and drawn by the
worker; they never pass through the window's own thread. Measured on the packaged app (M-series
Mac): the app is usable about 0.6 s after it starts, server included, and while a 6,000-word reply
streamed in beside a browser page that changed on every frame, the window kept drawing 60 frames a
second with no frame longer than 19 ms.
