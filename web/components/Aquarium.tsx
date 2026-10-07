'use client';
import { Fin } from './Fin';
import { cx } from './ui';
import { fishLabel, fishPose, type Fish, type Phase } from '@/lib/aquarium';

type Props = { fish: Fish[]; phase: Phase; selected?: string | null; onSelect?(id: string | null): void; className?: string; mini?: boolean };

export function Aquarium({ fish, phase, selected, onSelect, className, mini = false }: Props) {
  const ring = phase === 'formed' || phase === 'settled';
  const answered = fish.filter((f) => f.kind === 'answered').length;
  return (
    <div className={cx('relative overflow-hidden rounded-2xl border border-line bg-tank', className)}
      aria-label={`Campaign aquarium: ${answered} agents answered${ring ? ', school formed' : ''}`}>
      <div className="absolute inset-x-0 bottom-0 h-8 bg-tank-floor" />
      <span aria-hidden className="absolute left-[12%] top-[30%] size-2 border-2 border-white/80" />
      <span aria-hidden className="absolute left-[15%] top-[24%] size-1.5 border-2 border-white/80" />
      <span aria-hidden className="absolute left-[82%] top-[58%] size-2 border-2 border-white/80" />
      {ring && <div className="absolute left-[19%] top-[16%] h-[58%] w-[62%] rounded-3xl border-2 border-dashed border-ok bg-ok/5 transition-opacity duration-700" />}
      <div className={cx('absolute inset-0', mini && 'origin-top-left scale-50 [width:200%] [height:200%]')}>
        {fish.map((f, i) => {
          const label = fishLabel(f, phase);
          return (
            <button key={`${f.id}-${i}`} type="button" title={label} aria-label={label} tabIndex={mini ? -1 : 0}
              onClick={() => onSelect?.(selected === f.id ? null : f.id)}
              className={cx('absolute leading-none transition-[left,top,opacity] duration-[900ms] ease-out', selected === f.id && 'rounded-lg ring-2 ring-blue')}
              style={{ left: `${f.x}%`, top: `${f.y}%`, opacity: f.kind === 'deciding' ? 0.5 : 1 }}>
              <Fin pose={fishPose(f, phase)} size={32} flip={f.flip} still={mini} label="" />
              {f.kind === 'abstained' && (
                <span aria-hidden className="absolute -top-1 left-[26px] rounded-lg border-2 border-ink bg-surface px-1.5 py-0.5 font-pixel text-xs font-bold leading-none text-ink">no</span>
              )}
            </button>
          );
        })}
      </div>
      {ring && <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ok px-3 py-1 font-pixel text-[15px] font-bold text-on-accent">School formed</span>}
      {!mini && phase === 'settled' && <div className="absolute bottom-1.5 right-2"><Fin pose="paid" label="Fin delighted: payouts landed" /></div>}
      {!mini && phase === 'insufficient' && <div className="absolute bottom-1.5 right-2"><Fin pose="sleeping" label="Fin sleeping: cohort too small" /></div>}
    </div>
  );
}
