import type { Source } from '../feed';
import type { Position } from '../replay';
import type { Elements } from './elements';

/**
 * The "This week" controls, and the quick buttons beside Listen, set for what
 * the data allows and what is playing. A control that hid itself when pressed
 * hands focus to the one that replaced it.
 */
export function refreshWeekControls(el: Elements, s: Source, position: Position): void {
  const focused = document.activeElement;
  const usable = s.series.length > 1;
  el.scrub.disabled = !usable;
  el.scrub.max = String(Math.max(0, s.series.length - 1));
  el.yesterday.disabled = !usable;
  el.yesterdayQuick.disabled = !usable;
  el.yesterday.textContent = s.kind === 'sample' ? 'Play the sample day in 60 seconds' : 'Play yesterday in 60 seconds';
  el.yesterdayQuick.textContent = s.kind === 'sample' ? 'Sample day in 60 s' : 'Yesterday in 60 s';
  const replay = position.kind === 'replay';
  el.live.hidden = !(replay && s.kind === 'live');
  el.liveQuick.hidden = el.live.hidden;
  el.yesterdayQuick.hidden = !el.live.hidden;
  el.onwards.hidden = !(position.kind === 'replay' && !position.playing);
  if (s.kind === 'live' && s.history === 'loading') el.yesterday.textContent = 'Loading the week…';
  if (s.kind === 'live' && s.history === 'failed') el.yesterday.textContent = 'Week unavailable, retrying';
  if (focused instanceof HTMLElement && focused.hidden) {
    const next = new Map<HTMLElement, HTMLElement[]>([
      [el.yesterdayQuick, [el.liveQuick, el.play]],
      [el.liveQuick, [el.yesterdayQuick, el.play]],
      [el.onwards, [el.live, el.yesterday]],
      [el.live, [el.yesterday]],
    ]).get(focused);
    next?.find((b) => !b.hidden)?.focus();
  }
}
