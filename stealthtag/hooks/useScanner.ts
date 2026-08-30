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
 *
 * PRIVACY NOTE
 * ------------
 * Scanning is a correlation channel in its own right: the set of addresses a
 * client asks for balances on IS the set of payments belonging to one viewing
 * key. Every read here therefore goes through the relay (lib/relay.ts) rather
 * than a public RPC endpoint reached directly from the browser, so the RPC
 * provider sees the relay rather than the recipient. The relay operator still
 * sees it — this is a boundary, not anonymity.
 */

import { useState, useCallback, useMemo } from 'react';
import { createPublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { relayRpcTransport } from '@/lib/relay';
import { fetchAnnouncements } from '@/lib/announcer';
import { scanAnnouncements } from '@/lib/stealth';
import { getDemoAnnouncements, shouldUseDemoMode } from '@/lib/demo';
import type { DetectedPayment, StealthKeyBundle } from '@/types';

/** What a completed scan actually covered. Surfaced so the UI can never let a
 *  user read "no payments found" as "no payments exist". */
export interface ScanRange {
  fromBlock: bigint;
  toBlock: bigint;
  blocksScanned: bigint;
  announcementsSeen: number;
}

/** Default look-back. Bounded because public RPC providers cap `eth_getLogs`
 *  ranges; it is a provider limit, not a privacy or correctness choice. */
export const DEFAULT_SCAN_BLOCKS = 5000n;

interface UseScannerReturn {
  detectedPayments: DetectedPayment[];
  scanning: boolean;
  error: string | null;
  /** @param lookBackBlocks how many blocks back from head to scan */
  scan: (keyBundle: StealthKeyBundle, lookBackBlocks?: bigint) => Promise<void>;
  clearDetected: () => void;
  /** Range covered by the last completed scan; null before the first scan. */
  lastScan: ScanRange | null;
  isDemoMode: boolean;
}

export function useScanner(): UseScannerReturn {
  // Relay-backed client: never a direct browser→RPC-provider connection.
  const publicClient = useMemo(
    () => createPublicClient({ chain: sepolia, transport: relayRpcTransport() }),
    [],
  );
  const [detectedPayments, setDetectedPayments] = useState<DetectedPayment[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanRange | null>(null);
  const demoMode = shouldUseDemoMode();

  const scan = useCallback(
    async (keyBundle: StealthKeyBundle, lookBackBlocks: bigint = DEFAULT_SCAN_BLOCKS) => {
      setScanning(true);
      setError(null);

      try {
        let announcements;
        let range: ScanRange | null = null;

        if (demoMode) {
          // Demo mode: use pre-seeded announcements
          // The detection math is still real — these just won't match the demo keys
          // We simulate "found" payments by skipping detection and using demo data directly
          await new Promise((r) => setTimeout(r, 1200)); // simulate scanning delay
          announcements = getDemoAnnouncements();
        } else {
          // Real mode: fetch from the Announcer, through the relay.
          const latestBlock = await publicClient.getBlockNumber();
          const scanFrom =
            latestBlock > lookBackBlocks ? latestBlock - lookBackBlocks : 0n;
          announcements = await fetchAnnouncements(scanFrom, 'latest', publicClient);
          range = {
            fromBlock: scanFrom,
            toBlock: latestBlock,
            blocksScanned: latestBlock - scanFrom,
            announcementsSeen: announcements.length,
          };
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
                const balance = await publicClient.getBalance({
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
        setLastScan(range);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(`Scanning failed: ${message}`);
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
    lastScan,
    isDemoMode: demoMode,
  };
}
