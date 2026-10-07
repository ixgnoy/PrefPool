'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireWallet } from '@/components/RequireWallet';

// Everything under /seller needs a signed-in wallet, except onboarding (which includes the wallet step).
export default function SellerLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path.startsWith('/seller/onboarding')) return <>{children}</>;
  return <RequireWallet role="seller">{children}</RequireWallet>;
}
