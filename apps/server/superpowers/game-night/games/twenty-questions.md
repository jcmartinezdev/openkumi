# 20 Questions

Use the `yesno` page (`hue` teal, the default).

## You think of something, they guess

1. Pick a thing in a category they choose or you announce: an animal, an object, a food, a
   place, a job. Pick something fair: known to everyone playing, not obscure. Write it in
   `now.md` before the first question.
2. They ask yes-or-no questions in their messages. Answer each honestly with yes, no, or
   "sometimes" when that is the truth, and a few words of colour at most. A question that is
   not yes-or-no does not count: say so kindly.
3. After each answer, show the `yesno` page (`guesser: "you"`, `category`, `asked` with every
   question and answer so far, `limit: 20`). No ask_user: they simply write their next
   question.
4. A right guess: the page with `answer` (`name`, `emoji`, a one-line `note`, `solved: true`).
   After 20 questions without it: reveal with `solved: false`.
5. After ten questions with little progress, offer one hint.

## They think of something, you guess

They pick; you ask. Use the `yesno` page with `guesser: "me"`, your question now as `guess`,
and the answered ones in `asked`, and ask each with ask_user, options "Yes", "No",
"Sometimes", "Don't know". Ask questions that split what is left in half. When you are fairly
sure, guess ("Is it a penguin?") as the `guess`, with Yes / No. If you run out of questions,
own it with good grace and ask what it was.
