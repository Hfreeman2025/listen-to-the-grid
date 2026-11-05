import { LoudnessMatcher, type Match, PROVISIONAL_TRIM_DB } from './audio/match';
import { describeError, fetchCurrent } from './data/api';
import { type Region, regionFromSlug } from './data/regions';
import type { GridPeriod } from './data/series';
import { isFresh } from './data/time';
import { LiveFeed, liveSource } from './feed';
import { arrangementsFor, type Version } from './music/versions';
import { Player } from './player';
import { clock, periodLabel } from './ui/format';

/**
 * Listen to the Grid as a radio, for another page to embed: the piece's own
 * engine, conductor and data, with no score. It never makes a sound, or
 * touches the audio device, until play() is called from a click or key press;
 * stop() lets the device go. If NESO's live figures can't be had it says so
 * and plays nothing: no recording, nothing made up.
 */

export interface RadioOptions {
  /** a NESO region by its slug, e.g. "north-scotland"; Great Britain by default */
  region?: string;
  /** the grid as it is, or the piece's ossia: re-scored as fully renewable, a hypothetical */
  version?: Version;
  /** 0 to 1; the piece's own default is 0.75 */
  volume?: number;
}

export type RadioState =
  | { status: 'off'; reason: string }
  | { status: 'loading'; reason: string; region: string }
  | {
      status: 'playing';
      reason: string;
      region: string;
      version: Version;
      /** the half-hour being played: the newest NESO has published */
      halfHour: { start: string; end: string; label: string; measured: boolean; modelled: boolean };
      /** true while NESO is late or not answering: the last half-hour it published plays on */
      stale: boolean;
      /** the ossia's loudness match (ITU-R BS.1770), when that is the version playing */
      loudness: { realLufs: number; ossiaLufs: number; trimDb: number } | { provisionalTrimDb: number } | null;
    }
  | { status: 'failed'; reason: string };

export interface Radio {
  /** Start, from a click or key press. Resolves once playing, or failed (see state). */
  play(): Promise<void>;
  /** Stop and let go of the audio device. */
  stop(): Promise<void>;
  readonly state: RadioState;
  /** Listen for state changes; returns a function that stops listening. */
  on(event: 'state', fn: (state: RadioState) => void): () => void;
}

interface UserActivationNavigator {
  userActivation?: { isActive: boolean };
}

export function createRadio(options: RadioOptions = {}): Radio {
  const region: Region = regionFromSlug(options.region ?? null);
  const version: Version = options.version ?? 'real';
  const volume = Math.min(1, Math.max(0, options.volume ?? 0.75));
  const listeners = new Set<(state: RadioState) => void>();
  let state: RadioState = { status: 'off', reason: 'not started' };
  let player: Player | null = null;
  let feed: LiveFeed | null = null;
  let session = 0;
  let matched: { key: string; match: Match } | null = null;

  const set = (next: RadioState): void => {
    state = next;
    for (const fn of listeners) fn(state);
  };

  /** The ossia is matched to the real grid's loudness, half-hour by half-hour, as in the piece. */
  const matcher = new LoudnessMatcher(
    (key, match) => {
      if (version !== 'ossia' || !player) return;
      matched = { key, match };
      player.setTrim('ossia', match.trimDb);
      describe();
    },
    () => {
      describe();
    },
  );

  const describe = (): void => {
    const s = feed?.source;
    if (!player || s?.kind !== 'live') return;
    const p: GridPeriod = s.latest;
    const fresh = isFresh(Date.now(), p.start) && s.failedSince === null;
    const key = `${region.slug}|${p.start}`;
    const loudness =
      version !== 'ossia'
        ? null
        : matched?.key === key
          ? { realLufs: matched.match.real, ossiaLufs: matched.match.ossia, trimDb: matched.match.trimDb }
          : { provisionalTrimDb: matched?.match.trimDb ?? PROVISIONAL_TRIM_DB };
    const reason = fresh
      ? `playing the grid of ${region.name}, ${periodLabel(p)}, the newest half-hour NESO has published`
      : s.failedSince !== null
        ? `NESO hasn't answered since ${clock(s.failedSince)}; still playing the last half-hour it published, ${periodLabel(p)}`
        : `the next half-hour isn't out from NESO yet; still playing ${periodLabel(p)}`;
    set({
      status: 'playing',
      reason: version === 'ossia' ? `${reason}, re-scored as fully renewable (hypothetical)` : reason,
      region: region.slug,
      version,
      halfHour: {
        start: new Date(p.start).toISOString(),
        end: new Date(p.end).toISOString(),
        label: periodLabel(p),
        measured: p.measured,
        modelled: region.id !== null,
      },
      stale: !fresh,
      loudness,
    });
  };

  /** New figures: steer the orchestra to them, and match the ossia to them. */
  const follow = (): void => {
    const s = feed?.source;
    if (!player || s?.kind !== 'live') return;
    const p = s.latest;
    player.setArrangement(arrangementsFor(p.mix, p.intensity, player.mode, player.ossiaMode), 2.5);
    if (version === 'ossia') matcher.request(`${region.slug}|${p.start}`, { mix: p.mix, grams: p.intensity });
    describe();
  };

  const release = async (): Promise<void> => {
    feed?.stop();
    feed = null;
    const p = player;
    player = null;
    await p?.dispose();
  };

  return {
    get state() {
      return state;
    },

    // Typed for 'state' only; a page in plain JavaScript may ask for anything else, which never fires.
    on(event: string, fn: (state: RadioState) => void) {
      if (event !== 'state') return () => undefined;
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async play() {
      if (state.status === 'loading' || state.status === 'playing') return;
      // Not every browser has navigator.userActivation; where it does, insist on a gesture.
      const activation = (navigator as unknown as UserActivationNavigator).userActivation;
      if (activation && !activation.isActive) {
        set({ status: 'failed', reason: 'play() needs to be called from a click or key press' });
        return;
      }
      const mine = ++session;
      // Made now, inside the gesture, so the browser lets it sound; silent until the figures arrive.
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ latencyHint: 'playback' });
        void ctx.resume();
      } catch {
        set({ status: 'failed', reason: 'this browser could not start Web Audio' });
        return;
      }
      set({ status: 'loading', reason: `asking NESO for the latest half-hour of ${region.name}`, region: region.slug });
      let latest: GridPeriod;
      try {
        latest = await fetchCurrent(region);
      } catch (err) {
        await ctx.close();
        if (mine === session)
          set({ status: 'failed', reason: `couldn’t reach NESO’s live figures (${describeError(err)}), so nothing is playing` });
        return;
      }
      if (mine !== session) {
        await ctx.close(); // stopped while asking
        return;
      }
      const next = new Player(arrangementsFor(latest.mix, latest.intensity, null, null), () => undefined, 0);
      next.setVolume(volume);
      next.setVersion(version);
      next.setTrim('ossia', PROVISIONAL_TRIM_DB);
      player = next;
      feed = new LiveFeed(
        liveSource(region, latest, []),
        region,
        () => player !== null,
        (e) => {
          if (e.type === 'updated') follow();
        },
      );
      try {
        next.begin();
        await next.start(ctx);
      } catch {
        await release();
        set({ status: 'failed', reason: 'sound could not start in this browser' });
        return;
      }
      feed.start();
      follow();
    },

    async stop() {
      session++;
      await release();
      set({ status: 'off', reason: 'stopped' });
    },
  };
}
