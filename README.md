# Listen to the Grid

Great Britain's electricity grid, played live as an orchestral score. Each source of power has its own staff and
its own voice: wind is a string pad, solar rings bells, gas holds a low drone, nuclear keeps a steady pulse, hydro
runs like water, biomass sings, imports arrive as distant chords, and coal (should it ever return) is grit. Each
plays louder the bigger its share of generation, and carbon intensity chooses the key: a clean grid plays in bright
modes, a dirty one turns minor. The score is engraved as you listen, a note inked the moment it sounds. Pick any
day since 12 May 2018 and the page presses it as a record: a minute of audio rendered in your browser, with the
day's own score as its sleeve.

![The live score](shots/v2/live-desktop.png)

## Quickstart

Needs Node 22.12 or later.

```sh
npm ci
npm run dev
```

Open the address Vite prints (http://localhost:5173 unless that port is busy) and press **Listen**. To build the
static site and serve it as it would be deployed:

```sh
npm run build
npm run preview
```

`dist/` is plain static files (about 71 kB of gzipped JavaScript, plus a 1.5 kB loudness worker) and can be hosted anywhere. To build beside a
`dist/` that is being served, use `npx vite build --outDir dist-next` and test it with `DIST=dist-next npm run shots`. Link to a region with
`?region=north-scotland`, `?region=london` and so on (the slugs are in `src/data/regions.ts`).

## Any day, pressed as a record

Choose a day under **Any day, pressed as a record** and press. The page fetches that day from NESO (two requests;
yesterday is already on the page and costs none), composes it one bar an hour (23, 24 or 25 bars, whatever the
clocks did), engraves the sleeve, then renders the same bars offline with the same engine the page plays live,
faster than real time. You get:

- a 16-bit, 44.1 kHz stereo WAV of about a minute, with its title, artist, date and data credit inside it (RIFF
  INFO and an ID3 tag) and the sleeve embedded as cover art;
- the sleeve as a 2400 px PNG: the day's score as the first page of a printed edition, in three systems of eight
  bars (night, day, evening), each bar labelled with its hour;
- liner notes on the page: how many half-hours NESO had, the cleanest hour, the journey of keys.

The same date and place always press the same record. Rendering takes about 3 seconds in WebKit, 5 to 12 seconds in
Chromium and about a minute in Firefox, whose offline audio runs at roughly real time (it shows a running count
instead of a percentage, since Firefox doesn't report progress).

## Ossia: fully renewable

An ossia is the engraver's alternative passage, printed in small staves above the music. Press **Ossia: fully
renewable** (or **O**) and the moment you are hearing is re-scored for a hypothetical grid that runs on wind, sun and
water alone:

- gas, coal, nuclear, biomass, imports and other are set to zero, and their share is handed to wind, solar and hydro
  in proportion to each one's real share that half-hour (`src/music/ossia.ts`);
- if a half-hour had no wind, sun or water at all, there is nothing to scale up, so the ossia gives the whole grid to
  wind, the renewable that can run at any hour;
- NESO's factors for wind, solar and hydro are 0 g CO₂/kWh, so the ossia is 0 g and the key ladder puts it in D
  Lydian, *luminoso*.

Both versions of every bar are always composed, by two conductors in step, so switching is instant and mid-bar: the
sound changes without a restart and you hear the same moment real and renewable. The ossia is printed over the live
bar (over every bar of a replayed day), labelled *ossia: fully renewable, hypothetical*, and the rule and its
numbers (real mix against ossia mix, real grams against 0 g, real key against Lydian) appear under the controls. It
never appears in the **Live** label or the live bar's time. Pressed with the ossia on, a record is the ossia's: its
sleeve engraves only wind, solar and hydro, says *ossia* and *hypothetical* and marks the other parts tacet, and its
file names and tags say so too.

### A fair A/B: loudness matching with ITU-R BS.1770

Louder sounds better to most ears, and the ossia, with its big wind and solar parts and a brighter key, measures 1.8
to 2.7 LU louder than the real grid across the sample day. So the two are loudness-matched before you compare them,
with the broadcast standard's integrated loudness,
[ITU-R BS.1770-4](https://www.itu.int/rec/R-REC-BS.1770) (`src/audio/loudness.ts`): K-weighting (a high shelf for
the head and a 38 Hz high pass), mean square over 400 ms blocks overlapping by 75%, an absolute gate at −70 LUFS and a
relative gate 10 LU below, then the gated mean. It is tested against the standard's own 48 kHz filter coefficients
and the [EBU Tech 3341](https://tech.ebu.ch/publications/tech3341) reference signals (cases 1 to 4, both gates).

- **Live, per moment** (`src/audio/match.ts`, `src/ossia-loudness.ts`). When the ossia is on, the page renders the
  moment both ways offline, in your browser, sixteen bars each at 48 kHz, measures each, and trims the ossia to the
  real grid's loudness; the real grid keeps its own level. A replay is matched hour by hour, measuring the next hour
  ahead. While listening to the real grid it measures in the background, so switching is usually matched at once;
  until a moment is measured the last trim carries over, or, before any, the typical −2.2 dB, labelled provisional.
  The arithmetic runs in a worker. A measurement takes about 1.5 to 7 seconds depending on the browser and the
  machine, and the panel shows both loudnesses, the trims and the time it took.
- **How fair.** At every other half-hour of the sample day the page's own measurement set the trim, and an
  independent render of the same moment (other notes) checked it: the trimmed ossia and the real grid differ by
  0.06 LU at the median and 0.25 LU at most (`node scripts/measure-audio.mjs --loudness`).
- **Records.** Every pressed record, real or ossia, is measured and pressed to −16 LUFS (or as near as keeps its
  sample peak under −1 dBFS), and its liner notes and tags say so. The browser checks re-measure the downloaded WAV
  files in Node with the same meter.

Why not give each fuel its own key, fossil fuels minor and renewables major, sounding at once? Major and minor
thirds played together clash. The grid-wide key already says it: the cleaner the grid, the brighter the key, from D
Lydian below 60 g CO₂/kWh to D Phrygian from 240 g.

## How it works

```
NESO Carbon Intensity API ──> zod schemas ──> half-hour series ──> arrange() ──> Conductor (a bar at a time)
        (or bundled sample)      src/data          src/data          src/music        src/music
                                                                                          ├──> AudioEngine (live, or offline for records)
                                                                                          └──> engraver ──> live score / sleeve
```

- **Data** (`src/data`, `src/feed.ts`). National figures from `/generation` and `/intensity`, the week from
  `/generation/{from}/{to}` and `/intensity/{from}/{to}`, regions from `/regional/regionid/{id}` and
  `/regional/intensity/{from}/{to}/regionid/{id}`. Every response is validated with zod, cached copies included.
  The page polls a few minutes after each half-hour is due, keeps the week in `localStorage` for 25 minutes, and
  enforces its network allowlist with a Content-Security-Policy.
- **Composition** (`src/music`). Pure, seeded functions. Amplitude is the square root of a fuel's share. Intensity
  picks one of six modes on D (Lydian under 60 g to Phrygian from 240 g, with 5 g of hysteresis). The conductor
  writes a whole bar at a time in eight-bar phrases: one chord a bar, a half cadence at bar four and home to D at
  bar eight, a sung motif that repeats and answers itself, bells that reply in the voice's gaps, and a swell across
  each phrase that the engine plays and the score marks as hairpins. Every note is in the bar's key, so the score
  never needs an accidental.
- **Engraving** (`src/notation`). Rhythm spelling that respects the beat and the middle of the bar, ties, rests,
  beams, stems, ledger lines, octave clefs, modal key signatures (D Lydian is three sharps, D Phrygian two flats)
  with double bar lines and cancelling naturals when the key changes, dynamics where they change, entry marks
  (*l.v.*, *pizz.*, *lontano*), tempo and bar numbers. Clefs, rests, accidentals and dynamics are real glyphs from
  Noto Music. The live page is one system that reads through the last two hours, a bar a half-hour: the
  half-hours already past are engraved whole from their own figures (composed from midnight with a seed from the day
  and place, so a half-hour's bar never changes as the page moves on), and the last bar is the live half-hour, inked
  note by note as it sounds, with a red cursor following. Its bar numbers count the day's half-hours (17:00 is bar
  35). Hairpins are drawn bar by bar, so a swell can cross a bar line and stops at any new dynamic. A replayed day is
  written an hour a bar on pages that fill and turn.
- **Sound** (`src/audio`). A hand-written Web Audio graph: detuned-saw drone, four-voice pad with portamento, FM
  bells, a felt pulse, a formant singer, filtered-noise water, plucks and grit; per-voice buses with a phrase
  expression stage; a generated convolution reverb; then high-pass, tone, a light glue compressor, a limiter and a
  soft clip. Every data change is a ramp.
- **Honesty.** The page says whether a figure is measured or forecast, which half-hour it is, when it was checked,
  and that regional figures are modelled. The score's earlier bars are half-hours NESO published, never filled in
  across a gap; while the week is loading, or if it fails, they stay empty and say so. Only the newest half-hour is
  called live, in red; a late one is the latest, and a held or recorded one carries its time alone. Offline it
  plays `src/data/sample-day.json`, a real recording of Wednesday 28 October 2026, labelled with that date and never
  called live.

## Checks

```sh
npm run check     # typecheck, lint, unit tests, dependency licences
npm run measure   # renders the instrument offline: levels, clipping, clicks, phrasing, brightness
npm run shots     # every state at 1440×900 and 390×844 into shots/v2/, with checks in Chromium, WebKit, Firefox
node scripts/perf.mjs   # first engraved paint and frame cost during a replay, in all three browsers
npm run silence   # proves the automation is silent: no browser it drives holds a macOS audio assertion
```

Every browser these scripts drive is silent and opens no audio device: `scripts/silent.mjs` gives the page a live
AudioContext with no output (an OfflineAudioContext that is never rendered, keeping real time), and adds
`--mute-audio` in Chromium and a zero volume scale in Firefox. Records and measurements render offline to memory,
as they always do.

The unit tests assert concrete values for the tricky core: API schemas against real responses, UK days across
clock changes, the scale quantiser, voice leading, the mapping, the conductor (in key, spellable rhythms, phrases
that come home, a steady pulse), rhythm spelling, staff positions and key signatures, hairpins and ties across
bar lines, the half-hours before now (gaps never bridged, a past bar unchanged as the page moves on), the ossia's
mix (shares sum to 1, zero fossil and other, proportions kept, the fallback, Lydian at 0 g), whole-day composition,
BS.1770 loudness (the standard's filter coefficients, EBU Tech 3341 cases 1 to 4, gain tracking, silence), the
ossia's trim and the record level, the matcher's queue, the WAV and ID3 writer, the reverb impulse and the readouts. `npm run shots` and `scripts/perf.mjs` use Playwright, a
dev dependency here (`npx playwright install chromium webkit firefox` once).

`shots/v2/yesterday.wav` is a real record pressed by the page: Saturday 31 October 2026.

## Dependencies

One runtime dependency, zod (MIT), run in jitless mode so the page can forbid `eval`. Build and test tools: Vite,
Vitest, TypeScript, ESLint, typescript-eslint and Playwright. `npm run licences` checks every installed package
against MIT, Apache-2.0, BSD and ISC. Keeping that true needs two pins: ESLint stays on 9.x and typescript-eslint on
8.56 (later versions need a BlueOak-licensed minimatch), and `argparse` is pinned to its MIT 1.x (ESLint pulls in the
Python-licensed 2.x through js-yaml, which uses it only for its own command line). The cost is one moderate npm
advisory (GHSA-g3hv-75wg-m249) in that dev-only lint toolchain. Production dependencies audit clean.

## Credits

- Data: [Carbon Intensity API](https://carbonintensity.org.uk/) by the National Energy System Operator (NESO,
  formerly National Grid ESO), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and used
  under its [API terms](https://github.com/carbon-intensity/terms).
- Type: [Bodoni Moda](https://fonts.google.com/specimen/Bodoni+Moda), [Noto Music](https://fonts.google.com/noto/specimen/Noto+Music)
  and [Libre Franklin](https://fonts.google.com/specimen/Libre+Franklin), from Google Fonts.

## Licence

MIT. Copyright (c) 2026 Harry Freeman.
