import { describe, expect, it } from 'vitest';
import { PERSONHOOD_ACTION, UNVERIFIED_REASON, personhoodGate } from '../src/personhood.js';

describe('personhoodGate', () => {
  it('lets anyone answer ordinary campaigns', () => {
    expect(personhoodGate({}, false)).toEqual({ ok: true });
    expect(personhoodGate({ verifiedHumansOnly: false }, false)).toEqual({ ok: true });
  });
  it('limits verified-humans-only campaigns to verified agents', () => {
    expect(personhoodGate({ verifiedHumansOnly: true }, false)).toEqual({ ok: false, reason: UNVERIFIED_REASON });
    expect(personhoodGate({ verifiedHumansOnly: true }, true)).toEqual({ ok: true });
  });
  it('uses the agreed action and reason strings', () => {
    expect(PERSONHOOD_ACTION).toBe('cardanofish-seller');
    expect(UNVERIFIED_REASON).toBe('unverified: campaign requires verified humans');
  });
});
