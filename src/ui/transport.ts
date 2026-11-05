import type { Player } from '../player';
import type { Elements } from './elements';
import { store } from './store';

/**
 * The transport bar's sound controls: Listen, Pause and Resume, Mute and
 * Volume. Sound starts only from a press, as browsers insist, and the volume
 * and mute are remembered between visits.
 */
export class Transport {
  private starting: Promise<void> | null = null;
  private muted = store.get('muted') === '1';

  constructor(
    private readonly el: Elements,
    private readonly player: Player,
    private readonly announce: (text: string) => void,
  ) {
    const savedVolume = Number(store.get('volume') ?? '75');
    el.volume.value = String(Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 75);
    player.setVolume(Number(el.volume.value) / 100);
    player.setMuted(this.muted);
    el.mute.setAttribute('aria-pressed', String(this.muted));
  }

  /** Start the sound if needed, and resume it if paused. */
  async ensurePlaying(): Promise<void> {
    await this.ensureStarted();
    if (this.player.isPaused || this.player.interrupted) await this.player.resume();
    this.updatePlayButton();
  }

  async togglePlay(): Promise<void> {
    if (!this.player.started) await this.ensureStarted();
    else if (this.player.isPaused || this.player.interrupted) {
      await this.player.resume();
      this.announce('Resumed.');
    } else {
      await this.player.pause();
      this.announce('Paused.');
    }
    this.updatePlayButton();
  }

  /** The button says what pressing it will do; the browser can interrupt the sound on its own, so this is checked every second. */
  updatePlayButton(): void {
    const label = !this.player.started ? 'Listen' : this.player.isPaused || this.player.interrupted ? 'Resume' : 'Pause';
    if (this.el.playLabel.textContent !== label) this.el.playLabel.textContent = label;
    this.el.play.classList.toggle('playing', label === 'Pause');
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.player.setMuted(this.muted);
    this.el.mute.setAttribute('aria-pressed', String(this.muted));
    store.set('muted', this.muted ? '1' : '0');
    this.announce(this.muted ? 'Muted.' : 'Sound on.');
  }

  nudgeVolume(delta: number): void {
    const v = Math.min(100, Math.max(0, Number(this.el.volume.value) + delta));
    this.el.volume.value = String(v);
    this.setVolume(v);
  }

  setVolume(v: number): void {
    this.player.setVolume(v / 100);
    this.el.volume.setAttribute('aria-valuetext', `${v}%`);
    store.set('volume', String(v));
  }

  /** One start at a time: a second press while the first is still starting waits for it. */
  private ensureStarted(): Promise<void> {
    if (this.player.started) return Promise.resolve();
    this.starting ??= this.startSound().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startSound(): Promise<void> {
    try {
      await this.player.start();
    } catch {
      this.announce('Sound could not start in this browser. The score and the readings still work.');
      return;
    }
    this.player.setVolume(Number(this.el.volume.value) / 100);
    this.player.setMuted(this.muted);
    this.updatePlayButton();
    this.announce('Playing. The sound fades in over a few seconds.');
  }
}
