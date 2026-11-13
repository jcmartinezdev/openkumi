# Exchange rates

Rates come from two services that need no sign-in. Fetch them with `web_fetch`; both answer in
JSON.

## Frankfurter: the European Central Bank's rates

Use it whenever it has both currencies. It has these 30: AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD
HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR.

- Today: `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,GBP`
- An amount: `https://api.frankfurter.dev/v1/latest?amount=250&from=GBP&to=JPY`
- A past date: `https://api.frankfurter.dev/v1/2020-03-02?base=USD&symbols=EUR`
- A period: `https://api.frankfurter.dev/v1/2026-01-01..2026-03-31?base=EUR&symbols=USD`.
  For more than a year, ask for one or two currencies at a time, or the answer is cut off.

The bank publishes once each working day, at about 16:00 Central European Time, and not at
weekends or on its holidays. For such a day you get the last working day before it: give the
date the rate is from. The history starts on 4 January 1999.

## Currency API: everything else

For any currency Frankfurter does not have (ARS, CLP, COP, NGN, VND, …), crypto and metals. One
rate a day, from several public sources; codes are in lower case.

- Today: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/<base>.min.json`,
  for example `…/currencies/usd.min.json`. It gives `{"date": …, "usd": {"ars": …, "eur": …}}`:
  every currency against the base. Read only the ones you need.
- A past date: put the date in place of `latest`, as in `currency-api@2025-06-02`. The history
  starts on 2 March 2024.
- If that address fails, the same files are at
  `https://latest.currency-api.pages.dev/v1/currencies/<base>.min.json` (or `<date>.currency-api.pages.dev`).
- The list of codes: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.min.json`.

## Answering

- Give the amount, the rate, the date it is from and where it came from ("ECB reference rate
  of 12 November").
- These are mid-market reference rates. When the user is about to pay, change money or send it
  abroad, say that their bank, card or exchange office adds a margin of its own.
- Where people pay a very different rate from the official one (a parallel or "blue" rate),
  say that these figures may not be what changes hands on the street.
- How a rate moved over weeks or years is clearer as a chart: show it with `show_page`.
- Give the figures; do not predict where a rate is going.

## Alerts

"Tell me when the dollar goes above 1.15 euros" is a scheduled task. For currencies Frankfurter
has, run it Monday to Friday at a time after 16:30 Central European Time (times are the user's
local time, so work out theirs); for the others, once a day. Its runs see nothing of this
conversation, so put the two currencies, the level and the direction in the prompt, and say that
a run where the rate has not crossed it ends with exactly "Nothing to report." When a run
reports that it crossed, tell the user and delete the task, unless they asked to keep it.
