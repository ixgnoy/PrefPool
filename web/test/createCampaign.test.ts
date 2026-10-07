// createCampaign: 201 carries the screening wording warnings; 422 carries the rejection reasons.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCampaign } from '../lib/api';
import type { CampaignSpec } from '@as/shared';

const spec = { title: 't', category: 'payments', questions: [], audience: {}, rewardLamports: '1500000', maxResponses: 20, minCohort: 15, deadlineMs: 0 } as CampaignSpec;
const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe('createCampaign', () => {
  it('returns the wording warnings of a created campaign (empty when the server sends none)', async () => {
    reply(201, { campaignId: 'c1', state: 'AWAITING_FUNDING', accessToken: 'a1', warnings: ['q3: add an option'] });
    expect(await createCampaign(spec, 's')).toEqual({ ok: true, campaignId: 'c1', accessToken: 'a1', warnings: ['q3: add an option'] });
    reply(201, { campaignId: 'c2', state: 'AWAITING_FUNDING', accessToken: 'a2' });
    expect(await createCampaign(spec, 's')).toEqual({ ok: true, campaignId: 'c2', accessToken: 'a2', warnings: [] });
  });
  it('returns the screening reasons of a rejected campaign', async () => {
    reply(422, { campaignId: 'c3', state: 'REJECTED', reasons: ['unknown category: brand'] });
    expect(await createCampaign(spec, 's')).toEqual({ ok: false, reasons: ['unknown category: brand'] });
  });
});
