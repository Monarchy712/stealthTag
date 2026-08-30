'use client';

/**
 * hooks/useStealthKeys.ts
 * ------------------------
 * Stealth key generation, storage, and management for the recipient.
 *
 * DERIVATION (see lib/keys.ts for the full security model)
 * --------------------------------------------------------
 * Keys are derived with domain-separated HKDF-SHA256 from a master seed that
 * requires TWO inputs:
 *   1. one wallet signature over a message bound to {version, owner, chainId}
 *   2. a passphrase the user holds and types
 *
 * The passphrase never appears in the signed message and never leaves the
 * device, so a signature harvested by a malicious dapp is not enough to
 * reconstruct the stealth keys.
 *
 * STORAGE
 * -------
 * Only the PUBLIC half of the bundle (meta-address, both public keys, owner,
 * chainId, index) is written to localStorage. The spending and viewing PRIVATE
 * keys are held in memory for the session only — a module-level store keeps
 * them shared across pages during client-side navigation, and they are gone
 * after a reload, at which point the user re-derives them from wallet
 * signature + passphrase.
 *
 * This is still not production-grade key custody: the private keys live in JS
 * memory of a browser tab while unlocked. Hardware-backed or MPC custody is
 * the production answer.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useAccount, useChainId, useSignMessage } from 'wagmi';
import {
  buildKeyDerivationMessage,
  deriveMasterSeed,
  deriveStealthKeyBundle,
} from '@/lib/keys';
import type { StealthKeyBundle } from '@/types';

const STORAGE_KEY_PREFIX = 'stealthtag_pubkeys_';

/** The half of the bundle that is safe to persist. */
type PublicKeyBundle = Omit<
  StealthKeyBundle,
  'spendingPrivateKey' | 'viewingPrivateKey'
>;

function getStorageKey(address: string): string {
  return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
}

function toPublicBundle(bundle: StealthKeyBundle): PublicKeyBundle {
  return {
    spendingPublicKey: bundle.spendingPublicKey,
    viewingPublicKey: bundle.viewingPublicKey,
    metaAddress: bundle.metaAddress,
    ownerAddress: bundle.ownerAddress,
    chainId: bundle.chainId,
    accountIndex: bundle.accountIndex,
  };
}

function savePublicBundle(bundle: StealthKeyBundle): void {
  const publicBundle = toPublicBundle(bundle);
  try {
    localStorage.setItem(
      getStorageKey(bundle.ownerAddress),
      JSON.stringify(publicBundle),
    );
  } catch {
    // localStorage not available (SSR or private mode)
  }
}

function loadPublicBundle(address: string): PublicKeyBundle | null {
  try {
    const raw = localStorage.getItem(getStorageKey(address));
    if (!raw) return null;
    return JSON.parse(raw) as PublicKeyBundle;
  } catch {
    return null;
  }
}

// ===========================================================
// Session-only store for the unlocked private keys
// ===========================================================
// Module scope, not localStorage: survives client-side navigation between
// /setup, /send, /scan and /explore, but not a page reload.

let unlockedBundle: StealthKeyBundle | null = null;
const listeners = new Set<() => void>();

/** Cache of the persisted public halves, keyed by lowercased owner address.
 *  useSyncExternalStore requires a stable snapshot identity, so a repeated read
 *  for the same address must return the very same object. */
const publicCache = new Map<string, PublicKeyBundle | null>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setUnlockedBundle(bundle: StealthKeyBundle | null): void {
  unlockedBundle = bundle;
  notify();
}

function getUnlockedBundle(): StealthKeyBundle | null {
  return unlockedBundle;
}

/** Read the stored public bundle, memoized so the snapshot identity is stable. */
function getPublicBundle(address: string | undefined): PublicKeyBundle | null {
  if (!address) return null;
  const key = address.toLowerCase();
  if (!publicCache.has(key)) {
    publicCache.set(key, loadPublicBundle(key));
  }
  return publicCache.get(key) ?? null;
}

function setPublicBundle(address: string, bundle: PublicKeyBundle | null): void {
  publicCache.set(address.toLowerCase(), bundle);
  notify();
}

export type KeyState =
  /** No keys for this account on this device */
  | 'not_generated'
  /** Public meta-address known, but private keys not unlocked this session */
  | 'locked'
  | 'generating'
  | 'generated'
  | 'error';

interface UseStealthKeysReturn {
  /** Full bundle (with private keys) once unlocked this session */
  keyBundle: StealthKeyBundle | null;
  /** Public half — available even while locked */
  publicBundle: PublicKeyBundle | null;
  keyState: KeyState;
  error: string | null;
  /** Derive (or re-derive) the keys. Requires the user's passphrase. */
  generateKeys: (passphrase: string) => Promise<void>;
  /** Drop the in-memory private keys but keep the stored meta-address. */
  lockKeys: () => void;
  /** Forget everything for this account on this device. */
  clearKeys: () => void;
  isConnected: boolean;
}

export function useStealthKeys(): UseStealthKeysReturn {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const sessionBundle = useSyncExternalStore(
    subscribe,
    () => getUnlockedBundle(),
    () => null, // server snapshot
  );

  const publicBundle = useSyncExternalStore(
    subscribe,
    () => getPublicBundle(address),
    () => null, // server snapshot
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An unlocked bundle belonging to a different account must not leak through.
  const keyBundle =
    sessionBundle && address &&
    sessionBundle.ownerAddress.toLowerCase() === address.toLowerCase()
      ? sessionBundle
      : null;

  let keyState: KeyState = 'not_generated';
  if (error) keyState = 'error';
  else if (isGenerating) keyState = 'generating';
  else if (keyBundle) keyState = 'generated';
  else if (publicBundle) keyState = 'locked';

  const generateKeys = useCallback(
    async (passphrase: string) => {
      if (!address) {
        setError('Please connect your wallet first');
        return;
      }
      if (!passphrase) {
        setError('A passphrase is required — a wallet signature alone is not enough.');
        return;
      }

      setIsGenerating(true);
      setError(null);

      try {
        const signature = await signMessageAsync({
          message: buildKeyDerivationMessage(address, chainId),
        });

        const masterSeed = deriveMasterSeed({
          signature,
          passphrase,
          ownerAddress: address,
          chainId,
        });

        const bundle = deriveStealthKeyBundle({
          masterSeed,
          ownerAddress: address,
          chainId,
        });

        // Zero the seed once the keys are expanded from it.
        masterSeed.fill(0);

        savePublicBundle(bundle);
        setPublicBundle(address, toPublicBundle(bundle));
        setUnlockedBundle(bundle);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error during key generation';
        setError(
          msg.includes('rejected') || msg.includes('denied')
            ? 'Signature rejected — approve the signature to derive your stealth keys.'
            : `Key generation failed: ${msg}`,
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [address, chainId, signMessageAsync],
  );

  const lockKeys = useCallback(() => {
    setUnlockedBundle(null);
    setError(null);
  }, []);

  const clearKeys = useCallback(() => {
    if (address) {
      try {
        localStorage.removeItem(getStorageKey(address));
      } catch {
        // localStorage not available
      }
      setPublicBundle(address, null);
    }
    setUnlockedBundle(null);
    setError(null);
  }, [address]);

  return {
    keyBundle,
    publicBundle,
    keyState,
    error,
    generateKeys,
    lockKeys,
    clearKeys,
    isConnected,
  };
}
