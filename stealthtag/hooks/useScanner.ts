'use client';

/**
 * hooks/useScanner.ts
 * --------------------
 * Scanner hook for the recipient — watches the ERC-5564 Announcer and
 * detects incoming payments using view-tag filtering + full detection.
 *
 * Flow:
 *   1. Fetch announcements from ERC-5564 Announcer contract
 *   2. For each announcement, check view tag (fast 1-byte check)
 *   3. If view tag matches, run full ECDH detection with viewing key
 *   4. Return detected payments with computed stealth private keys
 */

import { useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { fetchAnnouncements } from '@/lib/announcer';
import { scanAnnouncements } from '@/lib/stealth';
import { getDemoAnnouncements, shouldUseDemoMode } from '@/lib/demo';
import type { DetectedPayment, StealthKeyBundle } from '@/types';

interface UseScannerReturn {
  detectedPayments: DetectedPayment[];
  scanning: boolean;
  error: string | null;
  scan: (keyBundle: StealthKeyBundle, fromBlock?: bigint) => Promise<void>;
  clearDetected: () => void;
  isDemoMode: boolean;
}

export function useScanner(): UseScannerReturn {
  const publicClient = usePublicClient();
  const [detectedPayments, setDetectedPayments] = useState<DetectedPayment[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demoMode = shouldUseDemoMode();

  const scan = useCallback(
    async (keyBundle: StealthKeyBundle, fromBlock?: bigint) => {
      setScanning(true);
      setError(null);

      try {
        let announcements;

        if (demoMode) {
          // Demo mode: use pre-seeded announcements
          // The detection math is still real — these just won't match the demo keys
          // We simulate "found" payments by skipping detection and using demo data directly
          await new Promise((r) => setTimeout(r, 1200)); // simulate scanning delay
          announcements = getDemoAnnouncements();
        } else {
          // Real mode: fetch from Announcer contract
          const latestBlock = await (publicClient as any).getBlockNumber();
          const scanFrom = fromBlock ?? (latestBlock > 5000n ? latestBlock - 5000n : 0n);
          announcements = await fetchAnnouncements(scanFrom, 'latest');
        }

        if (demoMode) {
          // In demo mode, simulate detected payments from the demo data
          const { DEMO_PAYMENTS } = await import('@/lib/demo');
          const simulated: DetectedPayment[] = DEMO_PAYMENTS.map((p) => ({
            stealthAddress: p.stealthAddress as `0x${string}`,
            stealthPrivateKey:
              '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
            ephemeralPublicKey: p.ephemeralPublicKey as `0x${string}`,
            blockNumber: p.blockNumber,
            transactionHash: p.transactionHash as `0x${string}`,
            balance: BigInt(Math.floor(parseFloat(p.amount) * 1e18)),
            swept: false,
          }));
          setDetectedPayments(simulated);
        } else {
          // Real mode: run actual view-tag + ECDH detection
          const detected = scanAnnouncements(announcements, keyBundle);

          // Fetch balances for detected addresses
          const withBalances = await Promise.all(
            detected.map(async (payment) => {
              try {
                const balance = await (publicClient as any).getBalance({
                  address: payment.stealthAddress,
                });
                return { ...payment, balance };
              } catch {
                return { ...payment, balance: 0n };
              }
            }),
          );

          setDetectedPayments(withBalances);
        }
      } catch (err: any) {
        setError(`Scanning failed: ${err?.message ?? 'Unknown error'}`);
      } finally {
        setScanning(false);
      }
    },
    [publicClient, demoMode],
  );

  const clearDetected = useCallback(() => {
    setDetectedPayments([]);
  }, []);

  return {
    detectedPayments,
    scanning,
    error,
    scan,
    clearDetected,
    isDemoMode: demoMode,
  };
}
