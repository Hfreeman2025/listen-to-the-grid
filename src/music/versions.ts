import type { Mix } from '../data/schema';
import { type Arrangement, arrange } from './mapping';
import { ossiaOf } from './ossia';
import type { Mode } from './theory';

/** The two versions of a moment: the grid as it is, and its fully renewable ossia. */
export type Version = 'real' | 'ossia';

/** The arrangement for each version of a moment, with each version's own key held through small changes. */
export function arrangementsFor(mix: Mix, grams: number, mode: Mode | null, ossiaMode: Mode | null): Record<Version, Arrangement> {
  const o = ossiaOf({ mix, grams });
  return { real: arrange(mix, grams, mode ?? undefined), ossia: arrange(o.mix, o.grams, ossiaMode ?? undefined) };
}
