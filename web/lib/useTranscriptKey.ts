'use client';
// Derive the owner's transcript key from a wallet signature; shared by "My answers" and the approval queue.
// The key lives in the store (this tab only), so unlocking in one place unlocks the other.
import { useState } from 'react';
import { bytesToHex, transcriptKeyFromSignature, transcriptKeyMessage, utf8ToBytes } from '@as/shared';
import { setTranscriptPublicKey } from './api';
import { useStore } from './store';

/** `serverKey`: the transcript public key the server has (null = none yet, undefined = not loaded). */
export function useTranscriptKey(serverKey: string | null | undefined) {
  const { session, ensureWallet, transcriptKey, setTranscriptKey } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = async () => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const w = await ensureWallet();
      // signMessage, not a transaction: ed25519 is deterministic, so the same wallet and message always yield the same key.
      const sig = await w.signMessage(utf8ToBytes(transcriptKeyMessage(session.address)));
      const key = transcriptKeyFromSignature(bytesToHex(sig));
      if (serverKey && serverKey !== key.publicKey) throw new Error('This wallet produces a different key than the one your agent seals to. Use the wallet you first unlocked with.');
      if (!serverKey) await setTranscriptPublicKey(session.sessionToken, key.publicKey);
      setTranscriptKey(key.privateKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The wallet declined to sign.');
    } finally { setBusy(false); }
  };
  return { transcriptKey, unlock, busy, error, setError };
}
