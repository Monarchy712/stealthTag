'use client';

/**
 * hooks/useSweep.ts
 * ------------------
 * Sweeps a detected stealth payment via an EIP-7702 + ERC-4337 UserOperation,
 * gas sponsored by a Paymaster, submitted through the StealthTag relay.
 *
 * TWO SEPARATE PROPERTIES, NOT ONE
 * --------------------------------
 * 1. Paymaster sponsorship removes the INBOUND link. The stealth address never
 *    has to receive gas money from the recipient's known wallet.
 * 2. The relay removes the browser's IP from what Pimlico and the RPC provider
 *    can see.
 *
 * Neither is anonymity, and neither touches the OUTBOUND link: whatever
 * address the user sweeps to is published on-chain next to the stealth
 * address. That is why `sweep` takes an explicit destination and this hook
 * never defaults it to the connected wallet.
 *
 * If the relay is not configured, the sweep is SIMULATED and labelled as such.
 * It never silently falls back to a direct browser→Pimlico call, because that
 * would hand Pimlico exactly the correlation the relay exists to remove.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  sponsoredSweep,
  simulateSweep,
  type GasMode,
  type SweepResult,
} from '@/lib/smartAccount';
import { isRelayConfigured } from '@/lib/relay';
import {
  generateDemoSweepHash,
  simulateBundlerDelay,
  shouldUseDemoMode,
} from '@/lib/demo';
import type { DetectedPayment, TxState } from '@/types';

export type RelayStatus = 'checking' | 'ready' | 'unconfigured';

interface UseSweepReturn {
  sweepState: TxState;
  /** Sweep a payment to an EXPLICIT destination. No default — see above. */
  sweep: (
    payment: DetectedPayment,
    toAddress: `0x${string}`,
    gasMode?: GasMode,
  ) => Promise<void>;
  resetSweep: () => void;
  /** Last successful real sweep, for showing what actually happened on-chain. */
  lastResult: SweepResult | null;
  relayStatus: RelayStatus;
  isDemoMode: boolean;
}

export function useSweep(): UseSweepReturn {
  const [sweepState, setSweepState] = useState<TxState>({ status: 'idle' });
  const [lastResult, setLastResult] = useState<SweepResult | null>(null);
  const forcedDemo = shouldUseDemoMode();
  const [relayStatus, setRelayStatus] = useState<RelayStatus>(
    forcedDemo ? 'unconfigured' : 'checking',
  );

  // The browser cannot see PIMLICO_API_KEY by design, so ask the relay whether
  // sponsored sweeping is actually available.
  useEffect(() => {
    if (forcedDemo) return;
    let cancelled = false;
    isRelayConfigured('bundler')
      .then((ok) => {
        if (!cancelled) setRelayStatus(ok ? 'ready' : 'unconfigured');
      })
      .catch(() => {
        if (!cancelled) setRelayStatus('unconfigured');
      });
    return () => {
      cancelled = true;
    };
  }, [forcedDemo]);

  const demoMode = forcedDemo || relayStatus !== 'ready';

  const sweep = useCallback(
    async (
      payment: DetectedPayment,
      toAddress: `0x${string}`,
      gasMode: GasMode = 'sponsored',
    ) => {
      if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
        setSweepState({
          status: 'failed',
          error: 'Enter a destination address before sweeping.',
        });
        return;
      }

      setSweepState({ status: 'pending' });
      setLastResult(null);

      try {
        if (demoMode) {
          // DEMO: no transaction is submitted. Clearly labelled downstream.
          await simulateBundlerDelay();
          await simulateSweep(payment, toAddress);
          setSweepState({
            status: 'confirmed',
            hash: generateDemoSweepHash(payment.stealthAddress),
            isSimulated: true,
          });
          return;
        }

        // REAL: EIP-7702 UserOperation, sponsored, relayed.
        setSweepState({ status: 'submitted' });
        const result = await sponsoredSweep(payment, toAddress, gasMode);

        setLastResult(result);
        setSweepState({
          status: 'confirmed',
          hash: result.transactionHash,
          isSimulated: false,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setSweepState({ status: 'failed', error: `Sweep failed: ${message}` });
      }
    },
    [demoMode],
  );

  const resetSweep = useCallback(() => {
    setSweepState({ status: 'idle' });
    setLastResult(null);
  }, []);

  return { sweepState, sweep, resetSweep, lastResult, relayStatus, isDemoMode: demoMode };
}
