export interface ShortcutActions {
  togglePlay(): void;
  toggleMute(): void;
  toggleOssia(): void;
  playYesterday(): void;
  goLive(): void;
  /** half-hours to move; negative is back */
  step(periods: number): void;
  nudgeVolume(delta: number): void;
}

/**
 * Single-key shortcuts. They never fire while typing in a field (including a
 * select's type-to-find), single letters ignore key repeat, and the arrows only
 * act on the page itself, the score or the playback bar, so elsewhere they
 * still scroll. `enabled` lets the listener switch them all off (WCAG 2.1.4).
 */
export function installShortcuts(enabled: () => boolean, actions: ShortcutActions): void {
  document.addEventListener('keydown', (e) => {
    if (!enabled() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const onControl = target?.closest('button, a, summary') ?? null;
    const arrowsOk =
      !target || target === document.body || target === document.documentElement || target.closest('#stage, .transport') !== null;
    switch (e.key) {
      case ' ':
        if (onControl || e.repeat) return;
        e.preventDefault();
        actions.togglePlay();
        break;
      case 'm':
      case 'M':
        if (!e.repeat) actions.toggleMute();
        break;
      case 'o':
      case 'O':
        if (!e.repeat) actions.toggleOssia();
        break;
      case 'y':
      case 'Y':
        if (!e.repeat) actions.playYesterday();
        break;
      case 'l':
      case 'L':
        if (!e.repeat) actions.goLive();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!arrowsOk) return;
        e.preventDefault();
        actions.step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 48 : 1));
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!arrowsOk) return;
        e.preventDefault();
        actions.nudgeVolume(e.key === 'ArrowUp' ? 5 : -5);
        break;
    }
  });
}
