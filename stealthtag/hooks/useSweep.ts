'use client';

/**
 * hooks/useSweep.ts
 * ------------------
 * Sponsored sweep hook — moves funds from detected stealth addresses
 * to the recipient's wallet via a Paymaster-sponsored UserOperation.
 *
 * The Paymaster sponsoring gas is the critical privacy-preserving step:
 * it means the stealth address never needs to be funded with ETH from
 * a known wallet (which would link the two addresses).
 *
 * In demo mode, the sweep is simulated and clearly marked.
 */

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { sponsoredSweep, simulateSweep } from '@/lib/smartAccount';
import {
  generateDemoSweepHash,
  simulateBundlerDelay,
  shouldUseDemoMode,
} from '@/lib/demo';
import type { DetectedPayment, TxState } from '@/types';

interface UseSweepReturn {
  sweepState: TxState;
  sweep: (payment: DetectedPayment, toAddress: `0x${string}`) => Promise<void>;
  resetSweep: () => void;
  isDemoMode: boolean;
}

export function useSweep(): UseSweepReturn {
  const { address } = useAccount();
  const demoMode = shouldUseDemoMode();

  const [sweepState, setSweepState] = useState<TxState>({ status: 'idle' });

  const sweep = useCallback(
    async (payment: DetectedPayment, toAddress: `0x${string}`) => {
      setSweepState({ status: 'pending' });

      try {
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.sepolia.org';
        const pimlicoKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY ?? '';

        let txHash: `0x${string}`;

        if (demoMode) {
          // DEMO MODE: simulate the sweep, clearly marked
          await simulateBundlerDelay();
          txHash = generateDemoSweepHash(payment.stealthAddress);

          setSweepState({
            status: 'confirmed',
            hash: txHash,
            isSimulated: true,
          });
        } else {
          // REAL MODE: sponsored sweep via Pimlico + Kernel smart account
          setSweepState({ status: 'submitted' });

          txHash = await sponsoredSweep(payment, toAddress, rpcUrl, pimlicoKey);

          setSweepState({
            status: 'confirmed',
            hash: txHash,
            isSimulated: false,
          });
        }
      } catch (err: any) {
        const message = err?.message ?? 'Unknown error';
        setSweepState({
          status: 'failed',
          error: message.includes('DEMO_MODE')
            ? 'Demo mode active — real sweep unavailable'
            : `Sweep failed: ${message}`,
        });
      }
    },
    [demoMode],
  );

  const resetSweep = useCallback(() => {
    setSweepState({ status: 'idle' });
  }, []);

  return { sweepState, sweep, resetSweep, isDemoMode: demoMode };
}
