# Weather

Weather comes from Open-Meteo, which needs no sign-in. Fetch every address below with
`web_fetch`; each answers in JSON. Ask only for the figures you need: a long hourly forecast is
large, and anything over 40,000 characters is cut off.

## Finding the place

`https://geocoding-api.open-meteo.com/v1/search?name=<place>&count=5&language=en`

It gives each match's `latitude`, `longitude`, `timezone`, `country_code` and `admin1` (the
region). Pick the one the user means; when two are likely, ask. Save the user's home place and
the units they use to `memory/`, so you do not have to look them up again.

## Forecast

`https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&timezone=auto&…`

- `current=temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m`
- `hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m`
- `daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset`
- `forecast_days=` 1 to 16 (7 if left out), or `forecast_hours=` for just the next few hours;
  `past_days=` up to 92 for the days just gone.
- Units: °C, km/h and mm unless you add `temperature_unit=fahrenheit`, `wind_speed_unit=mph`
  (or `ms`, `kn`) and `precipitation_unit=inch`.

`timezone=auto` gives every time in the place's own time zone. Say so when it is not the user's.

## Past weather and what a place is usually like

`https://archive-api.open-meteo.com/v1/archive?latitude=<lat>&longitude=<lon>&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&daily=…&timezone=auto`

It goes back to 1940, and its newest days are about five days old; for the last few days, use
the forecast with `past_days`. For "what is it usually like", fetch the same dates over the last
ten years and give the typical range, not one year's figures.

## Air quality, pollen and waves

- `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=<lat>&longitude=<lon>&current=european_aqi,us_aqi,pm2_5,pm10,ozone`.
  Pollen (`alder_pollen`, `birch_pollen`, `grass_pollen`, `mugwort_pollen`, `olive_pollen`,
  `ragweed_pollen`) is for Europe only, in its season.
- `https://marine-api.open-meteo.com/v1/marine?latitude=<lat>&longitude=<lon>&hourly=wave_height,wave_period,wave_direction`
  for the sea near a coast.

## Weather codes

`weather_code` is a WMO code: 0 clear; 1, 2, 3 mainly clear, partly cloudy, overcast; 45, 48
fog; 51, 53, 55 drizzle; 56, 57 freezing drizzle; 61, 63, 65 rain (light, moderate, heavy); 66,
67 freezing rain; 71, 73, 75 snow; 77 snow grains; 80, 81, 82 rain showers; 85, 86 snow showers;
95 thunderstorm; 96, 99 thunderstorm with hail.

## Answering

- Name the place and the day ("Saturday in Lisbon"), in the user's units.
- For rain, give the chance and the hours it is likely, not just the day's total.
- Past about seven days ahead a forecast is rough; say so.
- A week or more of figures is clearer as a chart: show it with `show_page`, and put "Weather
  data by Open-Meteo.com" under it.

## Regular reports and alerts

A morning forecast or an alert is a scheduled task. Its runs see nothing of this conversation,
so put the place's latitude, longitude and the units in the task's prompt. For an alert ("tell
me if it will freeze"), write the threshold into the prompt and say that a run that finds
nothing ends with exactly "Nothing to report."

## Rules

- The free service allows 10,000 requests a day, for non-commercial use. A run of a scheduled
  task makes one or two requests, never one per hour of the forecast.
