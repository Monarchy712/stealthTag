'use client';

/**
 * hooks/useStealthKeys.ts
 * ------------------------
 * Stealth key generation, storage, and management for the recipient.
 *
 * Keys are derived deterministically from wallet signatures:
 *   - Signing a fixed message → private key via keccak256(signature)
 *   - This means keys can always be regenerated from the same wallet
 *
 * Keys are stored in localStorage (encrypted by the wallet's address as a
 * simple namespace). This is NOT production-grade key storage — for a
 * hackathon prototype this is sufficient.
 *
 * SECURITY NOTE: In production, consider MPC or hardware-backed key storage.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import {
  generateStealthKeyBundle,
  STEALTH_KEY_MESSAGES,
} from '@/lib/stealth';
import type { StealthKeyBundle } from '@/types';

const STORAGE_KEY_PREFIX = 'stealthtag_keys_';

function getStorageKey(address: string): string {
  return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
}

function saveKeyBundle(bundle: StealthKeyBundle): void {
  try {
    localStorage.setItem(
      getStorageKey(bundle.ownerAddress),
      JSON.stringify({
        ...bundle,
        // Store as strings — JSON can't handle bigint
      }),
    );
  } catch {
    // localStorage not available (SSR or private mode)
  }
}

function loadKeyBundle(address: string): StealthKeyBundle | null {
  try {
    const raw = localStorage.getItem(getStorageKey(address));
    if (!raw) return null;
    return JSON.parse(raw) as StealthKeyBundle;
  } catch {
    return null;
  }
}

export type KeyState =
  | 'not_generated'
  | 'generating'
  | 'generated'
  | 'error';

interface UseStealthKeysReturn {
  keyBundle: StealthKeyBundle | null;
  keyState: KeyState;
  error: string | null;
  generateKeys: () => Promise<void>;
  clearKeys: () => void;
  isConnected: boolean;
}

export function useStealthKeys(): UseStealthKeysReturn {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [keyBundle, setKeyBundle] = useState<StealthKeyBundle | null>(null);
  const [keyState, setKeyState] = useState<KeyState>('not_generated');
  const [error, setError] = useState<string | null>(null);

  // Load from storage when address changes
  useEffect(() => {
    if (!address) {
      setKeyBundle(null);
      setKeyState('not_generated');
      return;
    }
    const stored = loadKeyBundle(address);
    if (stored) {
      setKeyBundle(stored);
      setKeyState('generated');
    } else {
      setKeyBundle(null);
      setKeyState('not_generated');
    }
  }, [address]);

  const generateKeys = useCallback(async () => {
    if (!address) {
      setError('Please connect your wallet first');
      return;
    }

    setKeyState('generating');
    setError(null);

    try {
      // Sign two domain-specific messages to derive spending + viewing keys
      const spendingSignature = await signMessageAsync({
        message: STEALTH_KEY_MESSAGES.spending,
      });

      const viewingSignature = await signMessageAsync({
        message: STEALTH_KEY_MESSAGES.viewing,
      });

      const bundle = generateStealthKeyBundle(
        address,
        spendingSignature,
        viewingSignature,
      );

      saveKeyBundle(bundle);
      setKeyBundle(bundle);
      setKeyState('generated');
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error during key generation';
      setError(
        msg.includes('rejected') || msg.includes('denied')
          ? 'Signature rejected — please approve both signatures to generate your stealth keys.'
          : `Key generation failed: ${msg}`,
      );
      setKeyState('error');
    }
  }, [address, signMessageAsync]);

  const clearKeys = useCallback(() => {
    if (address) {
      localStorage.removeItem(getStorageKey(address));
    }
    setKeyBundle(null);
    setKeyState('not_generated');
  }, [address]);

  return {
    keyBundle,
    keyState,
    error,
    generateKeys,
    clearKeys,
    isConnected,
  };
}
