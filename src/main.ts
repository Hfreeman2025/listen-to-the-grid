import { App, type Source } from './app';
import { describeError, fetchCurrent, fetchHistory, loadSample } from './data/api';
import { liveSource } from './feed';
import { elements } from './ui/elements';
import { REGIONS, regionFromSlug } from './data/regions';
import { paintBlankPage } from './visual/score';

async function boot(): Promise<void> {
  const el = elements();
  const region = regionFromSlug(new URLSearchParams(window.location.search).get('region'));
  // Loading: the empty page and the full list of places, while NESO answers.
  // The page ships with Great Britain already in the list, so the line keeps its width as the rest arrive.
  el.region.replaceChildren(...REGIONS.map((r) => new Option(r.name, r.slug, false, r === region)));
  el.key.textContent = 'Waiting for the first half-hour';
  void paintBlankPage(el.scoreCanvas);
  // The week is asked for alongside the latest half-hour: the first page
  // engraves the half-hours before now, so it opens as a full page of music.
  const week = fetchHistory(Date.now(), region);
  const settled = week.catch(() => null);
  let source: Source;
  try {
    const latest = await fetchCurrent(region);
    const early = await Promise.race([settled, new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, 1500);
    })]);
    source = liveSource(region, latest, early ?? undefined);
  } catch (err) {
    const sample = loadSample();
    source = { kind: 'sample', sample, series: sample.series, reason: describeError(err) };
  }
  new App(el, source, region, source.kind === 'live' ? week : null).run();
}

void boot();
