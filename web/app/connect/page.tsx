import type { Metadata } from 'next';
import { Card } from '@/components/ui';
import { WalletConnect } from '@/components/WalletConnect';

export const metadata: Metadata = { title: 'Connect wallet' };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/seller';
  return (
    <div className="mx-auto max-w-xl">
      <Card className="p-6 sm:p-8">
        <WalletConnect next={safeNext}
          intro="Use the same wallet for both roles. It's where your earnings arrive and what funds your campaigns." />
      </Card>
    </div>
  );
}
