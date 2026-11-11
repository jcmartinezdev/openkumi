Gives a bot your calendar. Ask it things like:

- "What does tomorrow look like?"
- "Find an hour next week when both Ana and I are free, not before 10."
- "Move Thursday's dentist appointment to the following Tuesday at the same time."

The bot looks things up freely. Before it creates, moves or cancels anything, or answers an
invitation, it tells you exactly what it is about to change and waits for a yes. It always
states the time zone, so "3 o'clock" never means something you did not intend.

## Two ways it can work

**Through the bot's own browser. Nothing to set up.** Install the plugin, open the bot's browser
panel, and sign in to Google there once. The bot then uses Google Calendar the way you would, by reading
and clicking the page. This works straight away, but it is slower, and Google sometimes asks the
browser to sign in again.

**Through Google's own connection. Faster and more dependable, with a one-time setup.** Google
offers a direct connection for Calendar (in developer preview at the time of writing). Google
requires every app that uses it to bring its own "client", so you create one, once, and all the
Google plugins share it:

1. Join the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview).
2. In the [Google Cloud console](https://console.cloud.google.com/), create a project and switch on the Google Calendar API.
3. Under **Google Auth Platform → Clients → Create client**, choose **Web application**.
4. Under **Authorized redirect URIs**, add `http://localhost:4317/api/mcp/callback`.
5. Tick **Use this client for an AI-powered agent**, create it, and copy the client ID and secret
   into the fields below.

After that, each bot that has the plugin shows a **Sign in** button here, and signs in with the
Google account you choose for it. Two bots can use two different accounts.
