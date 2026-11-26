# Guess the movie

Use the `clues` page with `hue: "blue"`, three clues a film, worth 3, 2 and 1 points.

Each film, mix the ways in:

- **In emoji**: the film told in three to six emoji, as `emojis` (a space between words
  shows as a gap), with the first clue as the first line of `clues` ("A film from 2001").
- **Told badly**: its plot in one flat, funny sentence, true but unhelpful ("A man walks for
  three hours to throw jewellery into a volcano"). No names.

Then a second clue (the year and the kind of film) and a third (a famous line of a few words,
or a lead actor). Pick films the players will know; ask what they like, or mix the decades.
Write each film and its clues in `now.md` before the first.

Each turn: the `clues` page (`clues` so far, `cluesTotal: 3`, `points`, `maxPoints: 3`, `emojis`,
`guesses`, `prompt` "Which film?"), then ask_user "Which film is it?", header "Your guess",
options "Next clue" and "I give up"; they write the title as their own answer. Reveal with
`answer` (`name` with the year, a one-line `note`, `solved`). Eight films is a game; then
`scores`.

Do not use song lyrics as clues, beyond a title.
