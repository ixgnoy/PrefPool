// shared/test/audience.test.ts
import { describe, expect, it } from 'vitest';
import { matchesAudience } from '../src/audience';

describe('matchesAudience', () => {
  const audience = { country: ['MY', 'SG'], ageBand: ['25-34'] };
  it('accepts a profile inside every targeted dimension', () => {
    expect(matchesAudience({ country: 'MY', ageBand: '25-34', occupationGroup: 'Student' }, audience)).toEqual({ ok: true });
  });
  it('abstains, naming the first dimension that excludes the profile', () => {
    expect(matchesAudience({ country: 'DE', ageBand: '25-34' }, audience)).toEqual({ ok: false, reason: 'no matching profile: country' });
    expect(matchesAudience({ country: 'SG', ageBand: '35-44' }, audience)).toEqual({ ok: false, reason: 'no matching profile: age band' });
  });
  it('abstains when the profile leaves a targeted dimension blank (it cannot claim to match)', () => {
    expect(matchesAudience({ ageBand: '25-34' }, audience)).toEqual({ ok: false, reason: 'no matching profile: country' });
  });
  it('an untargeted dimension never excludes anyone', () => {
    expect(matchesAudience({}, {})).toEqual({ ok: true });
    expect(matchesAudience({ country: 'MY' }, { country: ['MY'], occupationGroup: [] })).toEqual({ ok: true });
  });
});
