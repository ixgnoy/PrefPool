'use client';
// The "web agent" (FRONTEND_PRD §5.3 step 4, demo option): runs the owner's agent in this tab. Same rules as every
// other agent: `evaluatePolicy` from @as/shared decides; answers are sealed in the browser (only CRE can open them).
// Demo answers are derived deterministically from the wallet address, like the synthetic agents' (shared/answers.ts).
import { useEffect, useRef } from 'react';
import { calibrationGate, evaluatePolicy, matchesAudience, personhoodGate, sealEnvelope, syntheticAnswers } from '@as/shared';
import { audienceOf } from '@/lib/audience';
import { api, getActivity, type CampaignView } from '@/lib/api';
import { useStore } from '@/lib/store';
import { webAgentApprovalGate } from '@/lib/webAgent';

type AgentCampaign = Pick<CampaignView, 'campaignId' | 'title' | 'category' | 'questions' | 'rewardLamports' | 'deadlineMs'> & { envelopePublicKey: string; audience?: Record<string, string[]>; verifiedHumansOnly?: boolean; calibratedAgentsOnly?: boolean };
const POLL_MS = 5_000;

export function WebAgentRunner() {
  const { liveToken, session, agent, matchProfile, profile } = useStore();
  const handled = useRef(new Set<string>());
  const rules = agent?.policy ?? null; // the owner's saved guardrails; never fall back to defaults

  useEffect(() => {
    if (!liveToken || !session || !rules || agent?.paused) return;
    let stop = false;
    const tick = async () => {
      const { campaigns } = await api<{ campaigns: AgentCampaign[] }>('/agents/campaigns', { token: liveToken }).catch(() => ({ campaigns: [] }));
      const fresh = campaigns.filter((c) => !handled.current.has(c.campaignId));
      if (!fresh.length) return;
      // Today's answers come from the server, so a reload can't reset the daily limit.
      let answeredToday = (await getActivity(session.sessionToken).catch(() => null))?.totals?.todayCount;
      if (answeredToday === undefined) return; // can't check the daily limit: try again next tick
      for (const c of fresh) {
        if (stop) return;
        handled.current.add(c.campaignId);
        const ph = personhoodGate(c, !!agent?.personhood);
        const gate = ph.ok ? calibrationGate(c, agent?.calibration?.calibratedUntil ?? null, c.deadlineMs) : ph;
        const policyVerdict = gate.ok ? evaluatePolicy(rules, c, answeredToday) : gate;
        const audienceVerdict = policyVerdict.ok && matchProfile ? matchesAudience(audienceOf(profile), c.audience ?? {}) : policyVerdict;
        // No chat and no local hold queue here: if the owner wants to approve first, skip rather than answer silently.
        const verdict = audienceVerdict.ok ? webAgentApprovalGate(rules, c) : audienceVerdict;
        if (!verdict.ok) {
          await api(`/agents/campaigns/${c.campaignId}/decision`, { method: 'POST', token: liveToken, body: JSON.stringify({ kind: 'abstain', reason: verdict.reason }) }).catch(() => {});
          continue;
        }
        const answers = syntheticAnswers({ id: session.address, preferences: {} }, c.questions);
        const env = sealEnvelope(c.envelopePublicKey, c.campaignId, session.address, answers); // encrypted in this browser
        const sent = await api(`/agents/campaigns/${c.campaignId}/envelope`, { method: 'POST', token: liveToken, body: JSON.stringify(env) })
          .then(() => true, () => false);
        if (!sent) continue;
        answeredToday++;
        // Encrypt to self: a second sealed copy for the owner, readable only with their wallet-derived key.
        const me = await api<{ transcriptPublicKey: string | null }>('/agents/me', { token: liveToken }).catch(() => null);
        if (me?.transcriptPublicKey) {
          const copy = sealEnvelope(me.transcriptPublicKey, c.campaignId, session.address, answers);
          await api(`/agents/campaigns/${c.campaignId}/answer-copy`, { method: 'POST', token: liveToken, body: JSON.stringify(copy) }).catch(() => {});
        }
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [liveToken, session, rules, agent?.paused, matchProfile, profile]);

  return null;
}
