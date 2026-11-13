# Holidays

Holidays come from Nager.Date, which needs no sign-in. Fetch them with `web_fetch`; each answer
is JSON. Countries are two-letter codes (ES, DE, US, GB, …).

- A year: `https://date.nager.at/api/v3/PublicHolidays/<year>/<country>`
- The next twelve months: `https://date.nager.at/api/v3/NextPublicHolidays/<country>`
- Long weekends: `https://date.nager.at/api/v3/LongWeekend/<year>/<country>`. Each gives its
  `startDate`, `endDate` and `dayCount`; when `needBridgeDay` is true, `bridgeDays` are the
  working days to take off to make it.
- The countries it has: `https://date.nager.at/api/v3/AvailableCountries`

## Reading a holiday

- `global: true` means the whole country. Otherwise `counties` lists the regions that have it,
  as codes such as `ES-MD` (Madrid) or `US-CA`. Ask the user's region once and save it, with
  their country, to `memory/`. `LongWeekend` counts only national holidays: for a region, add
  its own holidays and work out the extra long weekends yourself.
- `types`: only `Public` is a day off for most people. `Bank` closes banks, `School` schools,
  `Authorities` public offices; `Optional` and `Observance` are not days off.
- `localName` is the holiday's name in the country's language, `name` in English.

## Using it

- For a trip, say which days fall on holidays where the user is going: shops and offices may
  be shut, and travel busier.
- For a meeting across countries, check every country taking part, regions included.
- A scheduled task does not know about holidays. When the user wants one skipped on holidays,
  write into its prompt: check `PublicHolidays` for this year and their country (and region);
  if today is a public holiday there, end with exactly "Nothing to report."
- For a country Nager.Date does not have, or a date that matters (a deadline, a bank or court
  closing), check the government's own page with a web search.
