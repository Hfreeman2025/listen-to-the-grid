import { describe, expect, it } from 'vitest';
import { GB, regionFromSlug } from '../src/data/regions';
import { describeState, esc, type ReadoutState } from '../src/ui/readout';

const period = { start: Date.UTC(2026, 10, 1, 11, 30), end: Date.UTC(2026, 10, 1, 12, 0) };
const checkedAt = Date.UTC(2026, 10, 1, 12, 4);
const live = (over: Partial<Extract<ReadoutState['source'], { kind: 'live' }>> = {}): ReadoutState['source'] => ({
  kind: 'live',
  region: GB,
  fresh: true,
  failedSince: null,
  checkedAt,
  ...over,
});
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('describeState', () => {
  it('calls fresh national data live and says when the next half-hour is due', () => {
    const r = describeState({ period, source: live(), playback: 'live' });
    expect(text(r.statusHtml)).toBe('Live: 11:30–12:00 GMT');
    expect(text(r.whenHtml)).toBe(
      'Live. The latest half-hour NESO has published: 11:30–12:00 GMT, Sunday 1 November 2026. Checked at 12:04; the next is due shortly after 12:30.',
    );
    expect(r.offline).toBe(false);
  });

  it('never calls the recorded sample live, and dates it', () => {
    const r = describeState({
      period: { start: Date.UTC(2026, 9, 28, 11, 0), end: Date.UTC(2026, 9, 28, 11, 30) },
      source: { kind: 'sample', reason: 'no network connection' },
      playback: 'replay-held',
    });
    expect(text(r.statusHtml)).toBe('Offline. Playing a recorded sample: Wednesday 28 October 2026.');
    expect(r.whenHtml).not.toMatch(/\bLive\b/);
    expect(text(r.whenHtml)).toContain('nothing here is live');
    expect(r.offline).toBe(true);
  });

  it('says how stale data is, rather than calling it live', () => {
    const r = describeState({ period, source: live({ fresh: false }), playback: 'live' });
    expect(text(r.statusHtml)).toBe('Latest available: 11:30–12:00 GMT');
    expect(r.offline).toBe(true);
  });

  it('owns up when the API stops answering', () => {
    const r = describeState({ period, source: live({ failedSince: Date.UTC(2026, 10, 1, 12, 34) }), playback: 'live' });
    expect(text(r.statusHtml)).toBe('Can’t reach NESO. Holding 11:30–12:00 GMT.');
    expect(text(r.whenHtml)).toContain('hasn’t answered since 12:34');
  });

  it('labels regional figures as modelled', () => {
    const r = describeState({ period, source: live({ region: regionFromSlug('north-scotland') }), playback: 'live' });
    expect(text(r.statusHtml)).toBe('North Scotland, live: 11:30–12:00 GMT (modelled estimate)');
  });

  it('keeps the status line steady while a replay plays', () => {
    const playing = describeState({ period, source: live(), playback: 'replay-playing' });
    const later = describeState({
      period: { start: period.start + 3_600_000, end: period.end + 3_600_000 },
      source: live(),
      playback: 'replay-playing',
    });
    expect(playing.statusHtml).toBe(later.statusHtml);
    expect(text(playing.statusHtml)).toBe('Replaying Sunday 1 November 2026');
    expect(text(describeState({ period, source: live(), playback: 'replay-held' }).statusHtml)).toBe(
      'Replaying Sun 1 Nov, 11:30–12:00 GMT',
    );
  });

  it('escapes text before it reaches the page', () => {
    expect(esc('<b>"x" & \'y\'</b>')).toBe('&#60;b&#62;&#34;x&#34; &#38; &#39;y&#39;&#60;/b&#62;');
  });
});
