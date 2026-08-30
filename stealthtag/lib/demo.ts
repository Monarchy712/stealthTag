/**
 * lib/demo.ts
 * -----------
 * Demo mode data and simulation helpers.
 *
 * When the bundler/Paymaster is unavailable (no API key, demo mode flag set),
 * this module provides:
 *   1. Demo "payments" whose stealth addresses, ephemeral public keys and view
 *      tags are REALLY derived with ERC-5564 Scheme 1 from the demo
 *      meta-address below, via the ScopeLift SDK.
 *   2. Simulated sweep responses clearly marked as [DEMO].
 *
 * Honest scope: the derivation is real, but `useScanner` short-circuits demo
 * mode and displays these entries directly instead of running detection over
 * them, and no funds exist at these addresses. Amounts and sender labels are
 * illustrative. The UserOperation submission is simulated.
 */

import { deriveStealthAddress, encodeAnnouncerMetadata } from './stealth';
import { deriveStealthKeyBundle } from './keys';
import type { DemoPayment, AnnouncementEvent } from '@/types';

// ===========================================================
// Demo meta-address
// ===========================================================
// Derived from a fixed, PUBLIC demo seed via the same HKDF path real users
// take (lib/keys.ts). It is a valid ERC-5564 Scheme 1 meta-address: two
// compressed secp256k1 public keys. Nothing of value is ever sent here.

const DEMO_SEED = new Uint8Array(32).fill(0x2a);
const DEMO_OWNER = '0x000000000000000000000000000000000000dEaD' as `0x${string}`;
const DEMO_CHAIN_ID = 11155111; // Sepolia

const DEMO_BUNDLE = deriveStealthKeyBundle({
  masterSeed: DEMO_SEED,
  ownerAddress: DEMO_OWNER,
  chainId: DEMO_CHAIN_ID,
});

export const DEMO_META_ADDRESS = DEMO_BUNDLE.metaAddress;

// Real ERC-5564 derivations against the demo meta-address. Each entry is a
// distinct one-time stealth address, exactly as a real sender would produce.
const DEMO_DERIVATIONS = [
  deriveStealthAddress(DEMO_META_ADDRESS),
  deriveStealthAddress(DEMO_META_ADDRESS),
  deriveStealthAddress(DEMO_META_ADDRESS),
];

export const DEMO_PAYMENTS: DemoPayment[] = [
  {
    stealthAddress: DEMO_DERIVATIONS[0].stealthAddress,
    amount: '0.05',
    senderLabel: 'Alice.eth',
    transactionHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    blockNumber: 7123456n,
    ephemeralPublicKey: DEMO_DERIVATIONS[0].ephemeralPublicKey,
  },
  {
    stealthAddress: DEMO_DERIVATIONS[1].stealthAddress,
    amount: '0.1',
    senderLabel: 'Bob.eth',
    transactionHash: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c',
    blockNumber: 7123890n,
    ephemeralPublicKey: DEMO_DERIVATIONS[1].ephemeralPublicKey,
  },
  {
    stealthAddress: DEMO_DERIVATIONS[2].stealthAddress,
    amount: '0.025',
    senderLabel: 'Charlie (anon)',
    transactionHash: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
    blockNumber: 7124200n,
    ephemeralPublicKey: DEMO_DERIVATIONS[2].ephemeralPublicKey,
  },
];

/**
 * Convert DemoPayment objects into AnnouncementEvent format for the scanner.
 */
export function getDemoAnnouncements(): AnnouncementEvent[] {
  return DEMO_PAYMENTS.map((p, i) => ({
    schemeId: 1n,
    stealthAddress: p.stealthAddress as `0x${string}`,
    ephemeralPubKey: p.ephemeralPublicKey as `0x${string}`,
    // ERC-5564 metadata: byte 0 is the view tag.
    metadata: encodeAnnouncerMetadata(DEMO_DERIVATIONS[i].viewTag),
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
 * Explicit demo-mode flag.
 *
 * NOTE: this no longer inspects a Pimlico API key — that key is server-side
 * now (see the relay). Whether real sweeping is available is answered by
 * `isRelayConfigured()` in lib/relay.ts, which asks the relay. Components
 * combine the two: demo mode is on if the flag is set OR the relay is
 * unconfigured.
 */
export function shouldUseDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}
