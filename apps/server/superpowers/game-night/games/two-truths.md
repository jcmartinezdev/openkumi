# Two truths and a lie

Use the `cards` page (`hue` coral, the default).

## You tell, they find the lie

1. A topic they choose, or one you announce: an animal, a country, space, a famous person,
   food, history, their own city. Five rounds is a game.
2. Each round, three statements: two true and surprising, one false but believable. Put the
   lie at a random place. Check both truths if you are at all unsure; a "truth" that is wrong
   spoils the game. Write the three and which is the lie in `now.md`.
3. Show the `cards` page (`title` "Round 2 · Space", `prompt` "Which one is the lie?", three
   cards with `title` "1", "2", "3", a fitting `emoji` and the statement as `text`), then
   ask_user with the options "1", "2", "3", each with its statement as the description.
4. The next turn shows the same cards stamped: "TRUE" (`tone: "good"`) on the truths, "LIE"
   (`tone: "bad"`) on the lie, and `last` with whether they found it and, in `note`, what is
   actually true. A point for each lie found. Then the next round's cards in the same turn.
5. After five rounds, the final `scores`.

## They tell, you find the lie

In a room, a player tells three things about themselves. Weigh them aloud, then show
`guesses` with which you think is the lie and how sure you are, and ask "Was I right?"
(Yes / No). Keep a score for yourself too.
