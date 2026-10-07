// createCampaign: 201 carries the screening wording warnings; 422 carries the rejection reasons.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createCampaign, createCampaignError } from '../lib/api';
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
  it('throws the throttle message on 429 (shown by the page instead of screening reasons)', async () => {
    const error = '10 rejected drafts in 24 hours; fix the questions and try again tomorrow';
    reply(429, { error, code: 'TOO_MANY_REJECTED' });
    const e = await createCampaign(spec, 's').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 429, code: 'TOO_MANY_REJECTED', message: error });
  });
  it('the page shows the throttle as its own state, other errors as a rejection', () => {
    const msg = '10 rejected drafts in 24 hours; fix the questions and try again tomorrow';
    expect(createCampaignError(new ApiError(429, 'TOO_MANY_REJECTED', msg))).toEqual({ throttled: true, message: msg });
    expect(createCampaignError(new ApiError(500, 'INTERNAL', 'internal error'))).toEqual({ throttled: false, message: 'internal error' });
    expect(createCampaignError(new Error('offline'))).toEqual({ throttled: false, message: 'offline' });
  });
});
