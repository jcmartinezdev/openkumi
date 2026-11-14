Lets a bot work in your Linear workspace, through Linear's own service. Ask it things like:

- "What is assigned to me this cycle, and what is blocked?"
- "File a bug for the login timeout, with what we found, in the Mobile team."
- "Summarise what moved in the Billing project this week."

There is nothing to set up. Activate it for a bot, press **Sign in**, and approve it on
Linear's own page. The bot sees what your Linear account sees.

Linear can also call OpenKumi the moment an issue or a comment is created or changed, so that an
automation starts at once instead of at its next look. That is a webhook, set up below, once for
each bot; it needs an admin of the Linear workspace, and an address the internet can reach this
computer by.

The bot reads freely and can file issues and comments. It asks before it changes the status,
assignee or priority of an existing issue.
