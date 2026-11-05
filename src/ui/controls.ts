import { REGIONS, type Region } from '../data/regions';
import type { Fuel } from '../data/schema';
import type { Elements } from './elements';
import type { ShortcutActions } from './keys';

/** Everything the page's controls can ask for; the keyboard asks for a subset of the same (see keys.ts). */
export interface ControlActions extends ShortcutActions {
  setVolume(percent: number): void;
  scrubTo(index: number): void;
  setRegion(region: Region): void;
  playOnwards(): void;
  audition(fuel: Fuel): void;
}

/** Wires the page's buttons, sliders and region menu to their actions. */
export function wireControls(el: Elements, voices: ReadonlyMap<Fuel, { button: HTMLButtonElement }>, a: ControlActions): void {
  el.play.addEventListener('click', () => {
    a.togglePlay();
  });
  el.mute.addEventListener('click', () => {
    a.toggleMute();
  });
  el.ossia.addEventListener('click', () => {
    a.toggleOssia();
  });
  el.volume.addEventListener('input', () => {
    a.setVolume(Number(el.volume.value));
  });
  el.scrub.addEventListener('input', () => {
    a.scrubTo(Number(el.scrub.value));
  });
  el.region.addEventListener('change', () => {
    const region = REGIONS.find((r) => r.slug === el.region.value);
    if (region) a.setRegion(region);
  });
  el.yesterday.addEventListener('click', () => {
    a.playYesterday();
  });
  el.yesterdayQuick.addEventListener('click', () => {
    a.playYesterday();
  });
  el.liveQuick.addEventListener('click', () => {
    a.goLive();
  });
  el.onwards.addEventListener('click', () => {
    a.playOnwards();
  });
  el.live.addEventListener('click', () => {
    a.goLive();
  });
  for (const [fuel, ref] of voices) {
    ref.button.addEventListener('click', () => {
      a.audition(fuel);
    });
  }
}
