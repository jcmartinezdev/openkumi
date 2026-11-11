Gives a bot your files in Google Drive, including Docs, Sheets and Slides. Ask it things like:

- "Find the latest version of the lease and tell me when it ends."
- "Add up the Q3 column in the budget sheet."
- "Write up these notes as a document in the Projects folder."

The bot searches and reads freely, and can create new files. It asks before it changes an
existing file, moves or deletes one, or changes who a file is shared with. A copy of anything
it downloads lands in its own `files/` folder, where you can see it.

## Two ways it can work

**Through the bot's own browser. Nothing to set up.** Install the plugin, open the bot's browser
panel, and sign in to Google there once. The bot then uses Google Drive the way you would, by reading
and clicking the page. This works straight away, but it is slower, and Google sometimes asks the
browser to sign in again.

**Through Google's own connection. Faster and more dependable, with a one-time setup.** Google
offers a direct connection for Drive (in developer preview at the time of writing). Google
requires every app that uses it to bring its own "client", so you create one, once, and all the
Google plugins share it:

1. Join the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview).
2. In the [Google Cloud console](https://console.cloud.google.com/), create a project and switch on the Google Drive API.
3. Under **Google Auth Platform → Clients → Create client**, choose **Web application**.
4. Under **Authorized redirect URIs**, add `http://localhost:4317/api/mcp/callback`.
5. Tick **Use this client for an AI-powered agent**, create it, and copy the client ID and secret
   into the fields below.

After that, each bot that has the plugin shows a **Sign in** button here, and signs in with the
Google account you choose for it. Two bots can use two different accounts.
