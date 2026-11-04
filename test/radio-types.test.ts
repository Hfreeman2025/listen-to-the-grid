import { describe, expect, it } from 'vitest';
import type * as Shipped from '../radio/listen-to-the-grid-radio';
import type * as Source from '../src/radio';

// The declaration file shipped with the radio must say exactly what the module does: each type is assigned both ways,
// so `npm run typecheck` fails the moment one drifts from the other.
const state: [Shipped.RadioState, Source.RadioState] = [null as unknown as Source.RadioState, null as unknown as Shipped.RadioState];
const options: [Shipped.RadioOptions, Source.RadioOptions] = [{} as Source.RadioOptions, {} as Shipped.RadioOptions];
const radio: [Shipped.Radio, Source.Radio] = [null as unknown as Source.Radio, null as unknown as Shipped.Radio];
const create: [typeof Shipped.createRadio, typeof Source.createRadio] = [null as unknown as typeof Source.createRadio, null as unknown as typeof Shipped.createRadio];

describe('the radio’s declaration file', () => {
  it('matches the module (checked by the type checker)', () => {
    expect([state, options, radio, create]).toHaveLength(4);
  });
});
