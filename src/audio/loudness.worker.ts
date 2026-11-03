import { integratedLoudness } from './loudness';

/** Measures BS.1770 integrated loudness off the main thread, so the score never stutters while it works. */
interface Job {
  id: number;
  channels: Float32Array[];
  fs: number;
  from: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = (e) => {
  const { id, channels, fs, from } = e.data;
  scope.postMessage({ id, integrated: integratedLoudness(channels, fs, from).integrated });
};
