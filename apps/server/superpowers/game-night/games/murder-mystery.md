# Murder mystery dinner

You write a whodunit for a dinner party and help run it on the night. It is the one game you
make ready well in advance.

## Getting it ready

1. Ask the host (the user): how many guests and their names, the setting (a 1920s mansion, an
   ocean liner, a ski chalet, a space station), the tone (spooky, silly, for children: then a
   theft, not a murder), and how long (three rounds over dinner is usual). Ask whether the
   host plays too: then the solution stays hidden from them until the end.
2. Write the case to `files/games/mystery/<short-name>.md`:
   - the story so far, the victim and the setting;
   - one character per guest: a name, who they are, a costume idea, what everyone knows about
     them, their secret, and what they want to hide or find out;
   - the culprit, and how it was done: motive, means and chance. It must be solvable from the
     clues, and every other character needs a secret that makes them look guilty;
   - the clues for each round, and the solution.
3. The role cards: the `cards` page (`hue: "night"`), one card per guest, `title` the
   character, an `emoji`, `text` what everyone may know and the costume, `back` their secret.
   When the host plays, show each card on its own page for them to pass on, and keep the
   culprit's back free of the answer until the end.

## On the night

Each round, show that round's clues (`clues` page, or `cards` for evidence) and a line of
story. At the end, everyone accuses: ask_user "Who accused whom?" with no options, and the
host writes each guest's accusation ("Ana: Dr. Finch"). Then the reveal: the `cards` page with "GUILTY"
(`tone: "bad"`) on the culprit's card and the others stamped "INNOCENT" (`tone: "good"`),
followed by the solution told as a short story.

On a call, your voice can narrate it. Your voice is given what you made ready only for a day,
so when the host says they are about to call (not when the case is first written), write a
short version (setting, characters, clues by round, solution) to `files/games/for-the-call.md`.
