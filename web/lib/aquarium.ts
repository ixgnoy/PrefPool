// web/lib/aquarium.ts — lays a campaign's agents out as fish in the tank (positions in percent).
// Fish come from the campaign view's pseudonymous tiles; agents that haven't decided yet are drawn as placeholders.
import type { Pose } from '@/components/Fin';
import type { AgentTile } from './api';

export type Phase = 'collecting' | 'aggregating' | 'formed' | 'settled' | 'insufficient';
export type FishKind = 'answered' | 'abstained' | 'deciding';
export type Fish = { id: string; kind: FishKind; x: number; y: number; flip: boolean; reason?: string; live: boolean };

const EDGE_X = [8, 52, 30, 74, 19, 63, 41, 85, 0];
const MAX_FISH = 40; // ponytail: the demo network is 30 agents; bigger cohorts would need a denser layout

export function layoutFish(tiles: AgentTile[], placeholders: number, phase: Phase): Fish[] {
  const tight = phase === 'formed' || phase === 'settled';
  const answered = tiles.filter((t) => t.kind === 'answer').slice(0, MAX_FISH);
  const abstained = tiles.filter((t) => t.kind === 'abstain').slice(0, MAX_FISH);
  const out: Fish[] = [];

  answered.forEach((t, i) => {
    const cols = tight ? 6 : 5;
    const c = i % cols, row = Math.floor(i / cols);
    const pos = tight
      ? { x: 21 + c * 9 + (row % 2) * 4.5, y: 20 + (row % 5) * 11 }
      : { x: 20 + c * 11.5 + (row % 2) * 5.5 + (((i * 37) % 5) - 2), y: 14 + (row % 5) * 13 + (((i * 53) % 5) - 2) };
    out.push({ id: t.tag, kind: 'answered', ...pos, flip: false, live: t.live });
  });
  abstained.forEach((t, k) => {
    out.push({ id: t.tag, kind: 'abstained', x: k % 2 ? 87 : -1, y: 8 + (Math.floor(k / 2) % 4) * 20, flip: k % 2 === 1,
      reason: t.reason ?? undefined, live: t.live });
  });
  for (let u = 0; u < Math.min(placeholders, MAX_FISH - out.length); u++) {
    const pos = u < 18
      ? { x: EDGE_X[Math.floor(u / 2)]!, y: u % 2 === 0 ? (Math.floor(u / 2) % 2 ? 6 : 1) : Math.floor(u / 2) % 2 ? 76 : 81 }
      : { x: 30 + ((u - 18) % 4) * 11, y: 44 + (Math.floor((u - 18) / 4) % 3) * 13 };
    out.push({ id: `waiting-${u}`, kind: 'deciding', ...pos, flip: u % 3 === 0, live: false });
  }
  return out;
}

export function fishPose(f: Fish, phase: Phase): Pose {
  if (f.kind === 'answered') return phase === 'settled' ? 'paid' : 'sealed';
  if (f.kind === 'deciding') return phase === 'collecting' ? 'swim' : 'sleeping';
  return 'abstain';
}

export function fishLabel(f: Fish, phase: Phase): string {
  if (f.kind === 'answered') return phase === 'settled' ? `${f.id}: answered; payouts went to the accepted answers` : `${f.id}: answered (sealed, encrypted)`;
  if (f.kind === 'abstained') return `${f.id}: abstained, ${f.reason ?? 'no reason given'}`;
  return phase === 'collecting' ? 'An agent that hasn\'t decided yet' : 'No answer before the deadline';
}
