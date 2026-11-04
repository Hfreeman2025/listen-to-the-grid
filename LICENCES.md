# Licences of what ships

The page's code is MIT (see [LICENSE](LICENSE)). Its one runtime dependency, zod, is MIT; `npm run licences`
checks every installed package against MIT, Apache-2.0, BSD and ISC.

## Fonts

Served from `public/fonts/` (latin subset; Noto Music's music-symbols subset), each family's licence beside its
files. Downloaded from jsDelivr's copy of the @fontsource 5.3.0 packages on 3 November 2026.

| Font | Version | Licence | File | Size | Source |
|---|---|---|---|---|---|
| IBM Plex Sans 400 | @fontsource/ibm-plex-sans 5.3.0 | SIL OFL 1.1 ([OFL-ibm-plex-sans.txt](public/fonts/OFL-ibm-plex-sans.txt)) | ibm-plex-sans-latin-400-normal.woff2 | 22,588 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/files/ibm-plex-sans-latin-400-normal.woff2 |
| IBM Plex Sans 400 italic | @fontsource/ibm-plex-sans 5.3.0 | SIL OFL 1.1 | ibm-plex-sans-latin-400-italic.woff2 | 24,356 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/files/ibm-plex-sans-latin-400-italic.woff2 |
| IBM Plex Sans 500 | @fontsource/ibm-plex-sans 5.3.0 | SIL OFL 1.1 | ibm-plex-sans-latin-500-normal.woff2 | 24,184 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/files/ibm-plex-sans-latin-500-normal.woff2 |
| IBM Plex Sans 600 | @fontsource/ibm-plex-sans 5.3.0 | SIL OFL 1.1 | ibm-plex-sans-latin-600-normal.woff2 | 24,252 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/files/ibm-plex-sans-latin-600-normal.woff2 |
| IBM Plex Mono 400 | @fontsource/ibm-plex-mono 5.3.0 | SIL OFL 1.1 ([OFL-ibm-plex-mono.txt](public/fonts/OFL-ibm-plex-mono.txt)) | ibm-plex-mono-latin-400-normal.woff2 | 14,708 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.3.0/files/ibm-plex-mono-latin-400-normal.woff2 |
| IBM Plex Mono 600 | @fontsource/ibm-plex-mono 5.3.0 | SIL OFL 1.1 | ibm-plex-mono-latin-600-normal.woff2 | 15,620 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.3.0/files/ibm-plex-mono-latin-600-normal.woff2 |
| IBM Plex Sans Condensed 500 | @fontsource/ibm-plex-sans-condensed 5.3.0 | SIL OFL 1.1 ([OFL-ibm-plex-sans-condensed.txt](public/fonts/OFL-ibm-plex-sans-condensed.txt)) | ibm-plex-sans-condensed-latin-500-normal.woff2 | 19,952 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-condensed@5.3.0/files/ibm-plex-sans-condensed-latin-500-normal.woff2 |
| IBM Plex Sans Condensed 600 | @fontsource/ibm-plex-sans-condensed 5.3.0 | SIL OFL 1.1 | ibm-plex-sans-condensed-latin-600-normal.woff2 | 19,816 B | https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-condensed@5.3.0/files/ibm-plex-sans-condensed-latin-600-normal.woff2 |
| Noto Music 400 (music symbols) | @fontsource/noto-music 5.3.0 | SIL OFL 1.1 ([OFL-noto-music.txt](public/fonts/OFL-noto-music.txt)) | noto-music-music-400-normal.woff2 | 56,324 B | https://cdn.jsdelivr.net/npm/@fontsource/noto-music@5.3.0/files/noto-music-music-400-normal.woff2 |

IBM Plex is © IBM Corp. (2017 for Mono, 2019 for Sans and Sans Condensed); Noto Music is © 2022 The Noto
Project Authors. The licence texts are each package's own `LICENSE`, from the same release.

## The radio (`dist-radio/`)

Its code is this repository's (MIT; `LICENSE` ships beside it). The only third-party code bundled into it is zod
(MIT). It carries no fonts. Its data is NESO's, below: a page that plays it must credit NESO.

## Data

Carbon Intensity API figures © NESO, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), used under the
[API terms](https://github.com/carbon-intensity/terms); the bundled sample day (`src/data/sample-day.json`) is one
day of them.
