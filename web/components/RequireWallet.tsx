'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button, EmptyState } from './ui';
import { useStore } from '@/lib/store';

/** Gates a page on a signed-in wallet and sends the user back here afterwards. */
export function RequireWallet({ children, role = 'seller' }: { children: ReactNode; role?: 'seller' | 'research' }) {
  const { ready, session } = useStore();
  const path = usePathname();
  if (!ready) return <div className="h-72 animate-pulse rounded-2xl bg-surface" />;
  if (!session) {
    return (
      <EmptyState
        pose={role === 'research' ? 'researcher' : 'sleeping'}
        text={role === 'research' ? 'Connect a Solana wallet to see your campaigns.' : 'Connect a Solana wallet to see your agent.'}
        action={<Button href={`/connect?next=${encodeURIComponent(path)}`}>Connect Solana wallet</Button>}
      />
    );
  }
  return <>{children}</>;
}
