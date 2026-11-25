Lets a bot hand coding work to the agents in [T3 Code](https://t3.codes/), and follow how it goes.
Ask it things like:

- "Ask T3 Code to fix the failing date test in the website project, and tell me when it's done."
- "What did the agents in T3 Code work on today?"
- "Find the thread where we talked about the release script, and tell me where it got to."

T3 Code has to run on the same computer as your bots, and be open whenever the bot uses it.

Activating it signs the bot in inside its own browser, on T3 Code's own page. That page asks for
a sign-in code, which you make in T3 Code under Settings → Sharing & access (Use T3 Code in
another app), and for what the bot may do there. Check that choice before you approve, since the
page can pick a mode for you:

- **Read only**: read projects and threads, and nothing else.
- **Supervised** and up: also start, message and stop threads. A thread the bot starts runs in no
  more than the mode you pick, so with Supervised its agent asks you in T3 Code before running
  commands or changing files.

The bot gets only T3 Code's tools for projects and threads: nothing that touches pull requests,
issues, settings or how a project is set up. It cannot answer an agent's questions or approvals
for you either.

The bot itself still cannot run code. The agents it starts in T3 Code can, as far as the mode you
picked lets them, so pick the lowest one that does the job. T3 Code lists the sign-in under
Settings → Sharing & access, where you can end it, and asks the bot to sign in again after 30
days.

The bot starts a thread only when you ask it to, and tells you which one it started.
