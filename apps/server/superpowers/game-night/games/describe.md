# Describe it

## You describe, they guess

Pick a word or phrase that fits the players (a thing, an animal, a job, a place, a film).
Write it in `now.md` with the three most obvious words you may not use. Describe it in one or
two sentences without the word itself or those three. After a wrong guess, describe it
another way. Three descriptions at most, worth 3, 2 and 1 points.

Each turn: the `clues` page (`hue: "amber"`, `prompt` "What am I describing?", your
descriptions as `clues`, `cluesTotal: 3`, `points`, `maxPoints: 3`, `guesses`), then ask_user "What
is it?", options "Another description" and "I give up"; they write their guess. Reveal with
`answer`. Ten words is a game.

## They describe, you guess

They think of a word and describe it without saying it; you guess. Show your guesses with the
`guesses` page (best first, how sure), and ask "Did I get it?" (Yes / No). Keep your score.

## In a room

One player describes, the others guess. Give the describer the word on the hidden side of a
card (`cards` page, one card: `title` "Your word", `text` "Only the describer looks: tap to
see it", `back`: the word and the words not to use). Then ask "Who guessed it?" with the
players, and show the next card.
