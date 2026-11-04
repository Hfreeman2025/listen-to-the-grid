/** Listen to the Grid as a radio: see README.md beside this file. */

export type Version = 'real' | 'ossia';

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

export function createRadio(options?: RadioOptions): Radio;
