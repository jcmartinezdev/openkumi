Google lets an app into your mail, calendar and files only once the app is registered with
Google. Notion and Linear let Open Bot register itself as it signs in; Google does not, and while
these Google services are in preview, it lets you register Open Bot only for yourself. So you do
it once, here, in about ten minutes. Every Google superpower and every bot then uses it.

You need a Google Workspace account (a work or school account, or one with a domain of your own)
that is in Google's preview program.

1. **Make a project.** In the Google Cloud console, [create a project](https://console.cloud.google.com/projectcreate),
   named "Open Bot" for example.
2. **Join the preview.** Sign up for the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview)
   with your Workspace account and that project. Google usually lets you in within a couple of days.
3. **Switch on the services.** [This page](https://console.cloud.google.com/flows/enableapi?apiid={{apis}})
   switches on everything the Google superpowers use, in one go. Choose your project there.
4. **Set up the sign-in page.** Open [Google Auth Platform](https://console.cloud.google.com/auth/branding)
   and press **Get started**. Name the app "Open Bot", and under **Audience** choose **Internal**,
   so only people in your organisation can sign in.
5. **Register Open Bot.** Under **Clients**, [create a client](https://console.cloud.google.com/auth/clients/create)
   of the type **Web application**. Under **Authorized redirect URIs**, press **Add URI** and add
   {{redirects}}. Tick **Use this client for an AI-powered agent**, then press **Create**.
6. **Copy two values.** Google shows a client ID and a client secret. Paste them below.

The client secret is kept on the computer that runs your bots, where the bots cannot read it.
