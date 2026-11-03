// Every browser these scripts drive is silent: the page plays music, and an
// automated run must never come out of the speakers, nor even open an audio
// device (macOS then holds an audio assertion for the browser).
//
//   All three: the init script below replaces the page's live AudioContext
//   with one that has no device at all. It is an OfflineAudioContext that is
//   never rendered, with a clock that keeps real time, so the page schedules
//   and draws exactly as it would while nothing is ever played. Muting alone
//   is not enough: a live context playing silence still opens the device.
//   Chromium: --mute-audio as well. Firefox: media.volume_scale 0 as well.
//
// OfflineAudioContext itself is left alone: records and measurements render
// to memory, and their output is what the checks read.

/** Runs in the page before its own scripts: `new AudioContext()` gets a context with no output device. */
export function silenceLiveAudio() {
  const Offline = window.OfflineAudioContext;
  if (!Offline) return;
  const now = () => performance.now() / 1000;
  class DeviceFreeAudioContext extends Offline {
    #base = now();
    #frozen = 0;
    #paused = false;
    #state = 'running';
    constructor() {
      super(2, 128, 44100);
    }
    get currentTime() {
      return this.#paused ? this.#frozen : now() - this.#base;
    }
    get state() {
      return this.#state;
    }
    get baseLatency() {
      return 0;
    }
    get outputLatency() {
      return 0;
    }
    getOutputTimestamp() {
      return { contextTime: this.currentTime, performanceTime: performance.now() };
    }
    resume() {
      if (this.#paused) {
        this.#base = now() - this.#frozen;
        this.#paused = false;
      }
      this.#state = 'running';
      return Promise.resolve();
    }
    suspend() {
      if (!this.#paused) {
        this.#frozen = this.currentTime;
        this.#paused = true;
      }
      this.#state = 'suspended';
      return Promise.resolve();
    }
    close() {
      void this.suspend();
      this.#state = 'closed';
      return Promise.resolve();
    }
  }
  window.AudioContext = DeviceFreeAudioContext;
  window.webkitAudioContext = DeviceFreeAudioContext;
}

/** Launch a browser that can make no sound. */
export function launchSilent(engine, name, args = []) {
  if (name === 'chromium') return engine.launch({ args: ['--mute-audio', ...args] });
  if (name === 'firefox') return engine.launch({ firefoxUserPrefs: { 'media.volume_scale': '0.0' } });
  return engine.launch();
}

/** A browser context whose pages can open no audio device. */
export async function silentContext(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(silenceLiveAudio);
  return context;
}
