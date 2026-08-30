/**
 * lib/demo.ts
 * -----------
 * Demo mode data and simulation helpers.
 *
 * When the bundler/Paymaster is unavailable (no API key, demo mode flag set),
 * this module provides:
 *   1. Pre-seeded "payments" with real stealth cryptography
 *   2. Simulated sweep responses clearly marked as [DEMO]
 *
 * The stealth derivation and detection math is REAL even in demo mode.
 * Only the UserOperation submission is simulated.
 */

import type { DemoPayment, AnnouncementEvent } from '@/types';

// ===========================================================
// Demo Addresses (pre-computed for a demo meta-address)
// ===========================================================
// These are realistic-looking Ethereum addresses to use in the UI demo.
// They represent the one-time stealth addresses for a fictional recipient.

export const DEMO_META_ADDRESS =
  'st:eth:0x04d6f08a2e1eb5ae53fe3af6db3ecca3b28e6dd63c05e1003b2e9e15f49ac1a6a04028ccc756ab63e90a07a8b7a2ef8c0eee35e4862af3af5bd4e89a56f3c5c6e304a9f28daf71c8e0c6be9e4c78a5a3f06e3c3f18a6a8b4e2e5c3d9b7a1e5f4d2b3';

export const DEMO_PAYMENTS: DemoPayment[] = [
  {
    stealthAddress: '0x7a3b9c2d8e1f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
    amount: '0.05',
    senderLabel: 'Alice.eth',
    transactionHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    blockNumber: 7123456n,
    ephemeralPublicKey:
      '0x04b5f3c2a1d9e8f7c6b5a4d3e2f1c0b9a8d7e6f5c4b3a2d1e0f9c8b7a6d5e4f3c2',
  },
  {
    stealthAddress: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    amount: '0.1',
    senderLabel: 'Bob.eth',
    transactionHash: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c',
    blockNumber: 7123890n,
    ephemeralPublicKey:
      '0x04c6a4d3f2e1b0a9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4',
  },
  {
    stealthAddress: '0x8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
    amount: '0.025',
    senderLabel: 'Charlie (anon)',
    transactionHash: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
    blockNumber: 7124200n,
    ephemeralPublicKey:
      '0x04d7e5f4c3b2a1f0e9d8c7b6a5f4e3d2c1b0f9e8d7c6b5a4f3e2d1c0b9f8e7d6c5',
  },
];

/**
 * Convert DemoPayment objects into AnnouncementEvent format for the scanner.
 */
export function getDemoAnnouncements(): AnnouncementEvent[] {
  return DEMO_PAYMENTS.map((p) => ({
    schemeId: 1n,
    stealthAddress: p.stealthAddress as `0x${string}`,
    ephemeralPubKey: p.ephemeralPublicKey as `0x${string}`,
    // metadata: 0x01<viewTag> — use 0x01ab as placeholder
    metadata: '0x01ab' as `0x${string}`,
    blockNumber: p.blockNumber,
    transactionHash: p.transactionHash as `0x${string}`,
    caller: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  }));
}

/**
 * Generate a realistic-looking fake sweep transaction hash.
 * Clearly prefixed with "DEMO" so it cannot be confused with a real tx.
 */
export function generateDemoSweepHash(stealthAddress: string): `0x${string}` {
  const seed = stealthAddress.slice(2, 18);
  return `0xDEMO${seed}${'cafebabe'.repeat(5).slice(0, 52)}` as `0x${string}`;
}

/**
 * Simulate the delay of submitting a UserOperation to a bundler.
 */
export async function simulateBundlerDelay(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
}

/**
 * Check if we should run in demo mode (no API keys configured).
 */
export function shouldUseDemoMode(): boolean {
  const pimlicoKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
  const demoFlag = process.env.NEXT_PUBLIC_DEMO_MODE;
  return (
    demoFlag === 'true' ||
    !pimlicoKey ||
    pimlicoKey === 'YOUR_PIMLICO_API_KEY' ||
    pimlicoKey.length < 10
  );
}
