# Trivia night

## Setting up

Ask in one ask_user what you do not know yet (skip what the user already said): the topics,
how many questions (5, 10 or 15), how hard, and who is playing (just them, or names for a room
game). Ten questions in two rounds of five is a good default.

## Where the questions come from

- **The Trivia API**, the first choice:
  `https://the-trivia-api.com/v2/questions?limit=10&categories=film_and_tv,music&difficulties=easy`.
  Categories: `music`, `sport_and_leisure`, `film_and_tv`, `arts_and_literature`, `history`,
  `society_and_culture`, `science`, `geography`, `food_and_drink`, `general_knowledge`.
  Difficulties: `easy`, `medium`, `hard`. Each question has `question.text`, `correctAnswer`
  and `incorrectAnswers`. Free for personal use.
- **Open Trivia DB**, for more topics:
  `https://opentdb.com/api.php?amount=10&type=multiple&category=11&difficulty=easy&encode=url3986`.
  The category numbers are at `https://opentdb.com/api_category.php` (9 general knowledge,
  11 film, 12 music, 17 science and nature, 21 sports, 22 geography, 23 history, …). The text
  comes percent-encoded: decode it. One request every five seconds; `response_code` 5 means
  wait and ask again. Its questions are shared under CC BY-SA 4.0, so give
  `"source": "Questions: Open Trivia DB (CC BY-SA 4.0)"` on every page that shows one.
- **Your own**, for a topic neither has (the user's family, a trip, a show they love, their
  town), or for a language other than English (both services are English only). Write them
  from what you know for sure and from your memory and files. Check anything you are not sure
  of.

Mix in now and then a true-or-false question (two options) and a picture question (a photo
from Wikipedia, see `celebrity.md`, as `image`). Put the right answer at a random place among
the options. Write every question with its answer into `now.md` before the first one.

## Playing

1. **Start**: the `title` page (emoji 🧠, the topics and the number of questions as the
   subtitle, the players, the rules), then the first question, in the same turn.
2. **Each question**: the `question` page (`number`, `total`, `category`, `question`,
   `options`, and `last` for how the previous one went), then ask_user:
   - alone: header "Question 3", the question as the question, the options as labels written
     "A · Casablanca", "B · …", in the page's order;
   - in a room: give the page `seconds: 20` and `answer`, plus the `board`; ask "Who got it
     right?" with `multiple: true`, the players and "Nobody" (more than five players: no
     options, the host writes the names).
3. **Scoring**: a point for each right answer. After each round, show `scores` (not final)
   with a line about how it is going, then the next question in the same turn.
4. **The end**: the final `scores` (`final: true`; alone: one player, "You", with `outOf`),
   and `last` for the last question. Then a line about the best moment, and offer a harder
   round or another topic.

When the user answers in writing instead of choosing, judge it as they meant it.
