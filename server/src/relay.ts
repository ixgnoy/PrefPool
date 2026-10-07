// server/src/relay.ts
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { agentByToken } from './auth.js';
import { acceptEnvelope, activeCampaignViews, recordDecision } from './agentService.js';
import { HttpError, type Broadcaster, type Deps } from './deps.js';
import type { CampaignView } from './views.js';

/** C6: /ws/agents?token=<agentToken>. Same validation as the REST agent endpoints. */
export function attachRelay(server: Server, getDeps: () => Deps): Broadcaster {
  const sockets = new Map<string, WebSocket>();
  const wss = new WebSocketServer({ server, path: '/ws/agents' });
  wss.on('connection', async (ws, req) => {
    const deps = getDeps();
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? '';
    const agent = await agentByToken(deps, token);
    if (!agent) return ws.close(4401, 'invalid agent token');
    sockets.set(agent.id, ws);
    ws.on('close', () => { if (sockets.get(agent.id) === ws) sockets.delete(agent.id); });
    ws.on('message', async (data) => {
      let ref = '';
      try {
        const msg = JSON.parse(String(data)) as { type: string; campaignId?: string; kind?: 'answer' | 'abstain'; reason?: string; envelope?: unknown };
        ref = `${msg.type}:${msg.campaignId ?? (msg.envelope as { campaignId?: string })?.campaignId ?? ''}`;
        if (msg.type === 'decision') await recordDecision(deps, agent, msg.campaignId ?? '', msg.kind === 'answer' ? 'answer' : 'abstain', msg.reason);
        else if (msg.type === 'envelope') await acceptEnvelope(deps, agent, msg.envelope);
        else throw new HttpError(400, 'BAD_TYPE', 'unknown message type');
        ws.send(JSON.stringify({ type: 'ack', ref, ok: true }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'ack', ref, ok: false, code: e instanceof HttpError ? e.code : 'BAD_REQUEST' }));
      }
    });
    // A paused agent gets no campaigns on connect; broadcasts may still reach it, but onDuty() refuses its decisions.
    if (!agent.paused) for (const campaign of await activeCampaignViews(deps)) ws.send(JSON.stringify({ type: 'campaign', campaign }));
  });
  return {
    broadcast(campaign: CampaignView) {
      const msg = JSON.stringify({ type: 'campaign', campaign });
      for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(msg);
    },
  };
}
