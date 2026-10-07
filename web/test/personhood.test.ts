// web/test/personhood.test.ts: the 'unverified' abstain reason maps to its bucket, label and fix-it link.
import { describe, expect, it } from 'vitest';
import { UNVERIFIED_REASON } from '@as/shared';
import { REASON_LABEL, REASON_RULE, bucketOf } from '../lib/policy';

describe('unverified abstain reason', () => {
  it('buckets, labels and links to World ID verification', () => {
    expect(bucketOf(UNVERIFIED_REASON)).toBe('unverified');
    expect(REASON_LABEL.unverified).toBe('Not a verified human');
    expect(REASON_RULE.unverified.href).toBe('/seller/agent#personhood');
  });
});

describe('uncalibrated abstain reason', () => {
  it('buckets, labels and links to calibration', async () => {
    const { UNCALIBRATED_REASON } = await import('@as/shared');
    expect(bucketOf(UNCALIBRATED_REASON)).toBe('uncalibrated');
    expect(REASON_LABEL.uncalibrated).toBe('Agent not calibrated');
    expect(REASON_RULE.uncalibrated.href).toBe('/seller/calibration');
  });
});
