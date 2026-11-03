/**
 * Per-viewer settings (volume, mute, shortcuts) in localStorage. Storage can
 * be blocked or full, so every access is guarded and failure just means the
 * setting is not remembered.
 */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`listen-to-the-grid:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`listen-to-the-grid:${key}`, value);
    } catch {
      // Storage blocked: the setting just won't be remembered.
    }
  },
};
