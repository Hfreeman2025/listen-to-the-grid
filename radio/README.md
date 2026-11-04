# Listen to the Grid: the radio

Great Britain's electricity grid, played live, for another page to embed. It is the piece's own engine,
conductor and data code (from `src/`), built on its own: no score, no page.

```js
import { createRadio } from './listen-to-the-grid-radio.js';

const radio = createRadio({ region: 'gb', version: 'real', volume: 0.75 });
radio.on('state', (s) => console.log(s.status, s.reason));
button.addEventListener('click', () => (radio.state.status === 'playing' ? radio.stop() : radio.play()));
```

- `play()` must be called from a click or key press. Nothing is made, fetched or opened before it; until then no audio
  device is touched. `stop()` closes the audio context and stops all polling, so the device is let go.
- `state.status` is `off`, `loading`, `playing` or `failed`, always with a `reason` in words. While playing it names
  the half-hour (the newest NESO has published), whether NESO's figure is measured or a regional model, and `stale`
  when NESO is late or not answering (the last half-hour it published plays on). If the live figures can't be had at
  all, it fails and plays nothing: no recording, nothing made up.
- `version: 'ossia'` plays the piece's hypothetical, fully renewable re-scoring, loudness-matched to the real grid
  with ITU-R BS.1770 exactly as in the piece (both versions rendered offline in the browser and measured in the
  worker in `assets/`). `state.loudness` reports the match, or the provisional trim until it is measured.
- Regions: `gb` (default), `scotland`, `england`, `wales`, `north-scotland`, `south-scotland`, `north-west-england`,
  `north-east-england`, `yorkshire`, `north-wales-merseyside`, `south-wales`, `west-midlands`, `east-midlands`,
  `east-england`, `south-west-england`, `south-england`, `london`, `south-east-england`. Regional figures are NESO's
  modelled estimates, and `state.halfHour.modelled` says so.

**What it needs from the page.** Serve this folder as it is, the module and `assets/` together (it finds its worker
beside itself). It fetches only from `https://api.carbonintensity.org.uk`: the latest half-hour (`/intensity` and
`/generation`, or `/regional/regionid/{id}`), again a few minutes after each half-hour is due. With a
Content-Security-Policy, allow `connect-src https://api.carbonintensity.org.uk` and, for the ossia,
`worker-src 'self'` (or wherever the folder is served from). It needs no fonts, styles or other hosts.

**Credit.** The figures are NESO's Carbon Intensity API, licensed CC BY 4.0: wherever the radio plays, credit
"Data: Carbon Intensity API, © NESO, CC BY 4.0".

**Licences.** The code is MIT (`LICENSE`). Bundled inside it: zod (MIT), the only third-party code.
