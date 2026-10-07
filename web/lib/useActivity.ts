'use client';
// Seller activity + totals (GET /api/agents/mine/activity), refreshed every 10 s while the page is open.
import { useEffect, useState } from 'react';
import { getActivity, type ActivityItem, type ActivityTotals } from './api';
import { useStore } from './store';

export function useActivity() {
  const { session } = useStore();
  const [data, setData] = useState<{ items: ActivityItem[]; totals: ActivityTotals | null; loading: boolean }>({ items: [], totals: null, loading: true });
  useEffect(() => {
    if (!session) return;
    let live = true;
    const load = () => getActivity(session.sessionToken).then((r) => live && setData({ ...r, loading: false })).catch(() => live && setData((d) => ({ ...d, loading: false })));
    void load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [session]);
  return data;
}
