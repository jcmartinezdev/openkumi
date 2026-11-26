Turns a bot into a game host. It runs the game, keeps the score and draws every step as a game
screen in the conversation: questions on coloured tiles, a clock, clues that unlock, a podium at
the end. Ask it things like:

- "Trivia night! Movies and music, 10 questions."
- "Let's play guess the celebrity."
- "Think of an animal, I'll find it in 20 questions."
- "Two truths and a lie about space."
- "Plan a murder mystery dinner for six on Saturday."

**Games:** trivia night, guess the celebrity, 20 Questions, two truths and a lie, guess the
movie, describe it, draw it (send a photo of your drawing and the bot guesses), and a murder
mystery dinner.

**Three ways to play:**

- **On your own**, in the conversation: you answer on question cards.
- **With friends in the room**, around one screen: the question shows with a clock and a
  button to show the answer, everyone shouts, and the bot asks you who got it right.
- **On a call**: the bot hosts out loud. For a round only it can write, such as one about your
  last trip, ask for it in writing first; the bot gets it ready, and its voice has it when you
  call within a day.

There is nothing to set up. Trivia questions come from Open Trivia DB and The Trivia API, free
services that need no sign-in, or the bot writes its own. Photos for guess the celebrity come
from Wikipedia. Scores are kept in the bot's files, in `files/games/`.
