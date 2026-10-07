'use client';
import { useEffect, useRef } from 'react';
import { C, poses } from '@/lib/fin-gen';

export type Pose = 'idle' | 'found' | 'policy' | 'abstain' | 'sealed' | 'swim' | 'school' | 'paid' | 'sleeping' | 'researcher';
const KEY: Record<Pose, number> = { idle: 0, found: 1, policy: 2, abstain: 3, sealed: 4, swim: 5, school: 6, paid: 7, sleeping: 8, researcher: 9 };

type PoseDef = { name: string; frames: (string | null)[][][]; ms?: number[] };
const PALETTE = C as Record<string, string>;
const cache = new Map<number, PoseDef[]>();
const posesFor = (n: number) => {
  if (!cache.has(n)) cache.set(n, poses(n) as unknown as PoseDef[]);
  return cache.get(n)!;
};

type Props = {
  pose?: Pose;
  /** Art size: 64 (landing hero), 48 (main Fin) or 32 (school / badges). */
  size?: 32 | 48 | 64;
  /** On-screen pixel size. Keep 2 everywhere so all sprites share one world. */
  px?: number;
  flip?: boolean;
  still?: boolean;
  /** Text equivalent. Pass '' for decorative sprites. */
  label?: string;
  className?: string;
};

export function Fin({ pose = 'idle', size = 48, px = 2, flip = false, still = false, label, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const p = posesFor(size)[KEY[pose]];
    const draw = (i: number) => {
      ctx.clearRect(0, 0, size, size);
      p.frames[i].forEach((row, y) => row.forEach((v, x) => { if (v) { ctx.fillStyle = PALETTE[v]; ctx.fillRect(x, y, 1, 1); } }));
    };
    draw(0);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || still || p.frames.length < 2) return;
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { t = setTimeout(() => { i = (i + 1) % p.frames.length; draw(i); tick(); }, p.ms?.[i] ?? 400); };
    tick();
    return () => clearTimeout(t);
  }, [pose, size, still]);

  const decorative = label === '';
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label ?? `Fin, ${pose}`}
      className={className}
      style={{ width: size * px, height: size * px, imageRendering: 'pixelated', transform: flip ? 'scaleX(-1)' : undefined, display: 'block' }}
    />
  );
}
