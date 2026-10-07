'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireWallet } from '@/components/RequireWallet';

// The builder is open to everyone (the wallet is asked for at the funding step); the rest needs a wallet.
export default function ResearchLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path.startsWith('/research/new')) return <>{children}</>;
  return <RequireWallet role="research">{children}</RequireWallet>;
}
