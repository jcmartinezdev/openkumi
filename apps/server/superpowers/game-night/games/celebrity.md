# Guess the celebrity

Use `hue: "pink"` (the default for clues).

## You think of someone, they guess

1. Ask what kind of famous person, unless they said: actors, musicians, athletes, people from
   history, or anyone. Choose someone the players are likely to know (for children, people
   children know). Write the name in `now.md` before the first clue.
2. Plan five clues, from vague to obvious: the first should fit many people, the last nearly
   gives it away. A right guess on clue 1 earns 5 points, on clue 5 one point.
3. A photo, for well-known faces: ask Wikipedia for everyone in the game at once, at
   `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages|description&piprop=thumbnail&pithumbsize=400&titles=Keanu%20Reeves|Meryl%20Streep`
   (the names only after the `?`, so the step's label does not show them). Use a person's
   `thumbnail.source` when the `description` is about them and the picture is of them. The
   page blurs it heavily at first and less with each clue. Leave the photo out for someone
   whose outline alone gives them away.
4. Each turn: the `clues` page (`clues` so far, `cluesTotal: 5`, `points` and `maxPoints: 5`, `image`,
   `guesses` with the wrong ones), then ask_user: "Who is it?", header "Your guess", options
   "Next clue" and "I give up". They write a guess as their own answer.
5. A right guess: the `clues` page with `answer` (`name`, a one-line `note` worth knowing,
   `image`, `solved: true`) and `last` (`right: true`, the points). A wrong one: add it to
   `guesses` and give the next clue. After the fifth clue and a wrong guess, or "I give up":
   reveal with `solved: false`.
6. Play three to five people, then show the `scores`.

In a room, anyone can call out a guess; ask "Who got it?" with the players.

## They think of someone, you guess

They think of a famous person and you find who with yes-or-no questions, up to 20. Use the
`yesno` page (`guesser: "me"`, your current question as `guess`, the answered ones in
`asked`) and ask each question with ask_user, options "Yes", "No", "Sort of", "Don't know".
Ask questions that split the field (alive? an actor? from Europe?). When you are fairly sure,
show `guesses` with your top three and how sure you are, and ask "Is it …?" (Yes / No).
