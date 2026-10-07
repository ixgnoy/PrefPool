'use client';
// Seller dashboard nudge: shows only while a calibration round waits for the owner's answers.
import { useEffect, useState } from 'react';
import { Button } from './ui';
import { getCalibration, type CalibrationStatus } from '@/lib/api';
import { useStore } from '@/lib/store';

export function CalibrationBanner() {
  const { session, agent } = useStore();
  const [s, setS] = useState<CalibrationStatus | null>(null);
  useEffect(() => {
    if (!session || agent?.kind !== 'plugin') return;
    getCalibration(session.sessionToken).then(setS).catch(() => {});
  }, [session, agent?.kind]);
  const state = s?.round?.state;
  if (state !== 'AGENT_ANSWERED' && state !== 'OWNER_ANSWERING') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-soft px-5 py-4">
      <span className="text-sm"><b>Your turn to calibrate.</b> Your agent answered 15 questions about you; answer the same ones (10 minutes).</span>
      <Button size="sm" href="/seller/calibration">Answer now</Button>
    </div>
  );
}
