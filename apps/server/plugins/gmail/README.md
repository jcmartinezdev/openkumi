Gives a bot your inbox. Ask it things like:

- "What came in since yesterday that I actually need to answer?"
- "Find the invoice Marta sent in March and tell me the total."
- "Draft a reply to the landlord saying the 14th works."

The bot reads and searches freely, and writes drafts. It does not send, archive or delete
anything until it has shown you exactly what it is about to do and you have said yes. As it
works with you it notes how you like to write and who your regular contacts are, so its drafts
get closer to yours over time.

## Two ways it can work

**Through the bot's own browser. Nothing to set up.** Install the plugin, open the bot's browser
panel, and sign in to Google there once. The bot then uses Gmail the way you would, by reading
and clicking the page. This works straight away, but it is slower, and Google sometimes asks the
browser to sign in again.

**Through Google's own connection. Faster and more dependable, with a one-time setup.** Google
offers a direct connection for Gmail (in developer preview at the time of writing). Google
requires every app that uses it to bring its own "client", so you create one, once, and all the
Google plugins share it:

1. Join the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview).
2. In the [Google Cloud console](https://console.cloud.google.com/), create a project and switch on the Gmail API.
3. Under **Google Auth Platform → Clients → Create client**, choose **Web application**.
4. Under **Authorized redirect URIs**, add `http://localhost:4317/api/mcp/callback`.
5. Tick **Use this client for an AI-powered agent**, create it, and copy the client ID and secret
   into the fields below.

After that, each bot that has the plugin shows a **Sign in** button here, and signs in with the
Google account you choose for it. Two bots can use two different accounts.
