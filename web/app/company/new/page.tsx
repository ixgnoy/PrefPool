'use client';
// Old route: funding links from earlier plugin builds point here (with #draft=…). Keep the hash.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function OldCompanyNew() {
  const router = useRouter();
  useEffect(() => { router.replace(`/research/new${window.location.hash}`); }, [router]);
  return null;
}
