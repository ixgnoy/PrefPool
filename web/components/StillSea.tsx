'use client';
// Still lagoon behind app pages: the landing page's water, frozen and faded into the page from below.
// Landing renders its own animated waves, so this stays off there.
import { usePathname } from 'next/navigation';
import { LagoonWaves } from './LagoonWaves';

export function StillSea() {
  if (usePathname() === '/') return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 [mask-image:linear-gradient(to_top,black_8%,rgb(0_0_0/.55)_30%,transparent_58%)]">
      <LagoonWaves still />
    </div>
  );
}
