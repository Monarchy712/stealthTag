/**
 * lib/chain.ts
 * -----------
 * Chain configuration, contract addresses, and viem clients for StealthTag.
 *
 * We target Ethereum Sepolia (chainId 11155111) where both the ScopeLift
 * ERC-5564/6538 canonical contracts and the Pimlico bundler/paymaster
 * are available.
 */

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

// ===========================================================
// Contract Addresses — Sepolia Testnet
// ===========================================================
// These are the canonical ScopeLift deployments.
// Source: https://github.com/ScopeLift/stealth-address-erc-contracts

export const CONTRACT_ADDRESSES = {
  /** ERC-5564 Announcer: stores ephemeral pubkey + view tag for each payment */
  ANNOUNCER: '0x55649E01B5Df198D18D95b5cc5051630cfD45564' as `0x${string}`,
  /** ERC-6538 Registry: maps EOA addresses to stealth meta-addresses */
  REGISTRY: '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538' as `0x${string}`,
} as const;

// ===========================================================
// ERC-5564 Scheme ID
// ===========================================================
// Scheme 1 = secp256k1 with view tags (the scheme used by ScopeLift SDK)
export const STEALTH_SCHEME_ID = BigInt(1);

// ===========================================================
// ERC-5564 Announcer ABI (minimal — only what we need)
// ===========================================================
export const ANNOUNCER_ABI = [
  {
    type: 'function',
    name: 'announce',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Announcement',
    inputs: [
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthAddress', type: 'address', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ephemeralPubKey', type: 'bytes', indexed: false },
      { name: 'metadata', type: 'bytes', indexed: false },
    ],
  },
] as const;

// ===========================================================
// ERC-6538 Registry ABI (minimal)
// ===========================================================
export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerKeys',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthMetaAddress', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stealthMetaAddressOf',
    inputs: [
      { name: 'registrant', type: 'address' },
      { name: 'schemeId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'StealthMetaAddressSet',
    inputs: [
      { name: 'registrant', type: 'address', indexed: true },
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthMetaAddress', type: 'bytes', indexed: false },
    ],
  },
] as const;

// ===========================================================
// Chain Config
// ===========================================================
export const TARGET_CHAIN = sepolia;
export const CHAIN_ID = 11155111;

// ===========================================================
// Public Client
// ===========================================================
// All recipient-side reads go through the relay (see lib/relay.ts) so the RPC
// provider does not learn which stealth addresses one viewing key queries.
// `rpcUrl` is accepted for scripts and server-side use.

export function createSepoliaClient(rpcUrl?: string) {
  return createPublicClient({
    chain: sepolia,
    transport: rpcUrl
      ? http(rpcUrl)
      : http(process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.sepolia.org'),
  });
}

// ===========================================================
// Bundler / Paymaster
// ===========================================================
// There is deliberately NO browser-side Pimlico URL helper any more.
//
// The previous `getPimlicoUrl(apiKey)` was called from the browser with
// NEXT_PUBLIC_PIMLICO_API_KEY, which (a) shipped the API key to every visitor
// and (b) let Pimlico see the user's IP alongside the stealth address, the
// destination and the amount. Both are handled by the relay now: the key lives
// in the server-only PIMLICO_API_KEY, and the browser talks to /api/relay.
//
// The upstream URL is constructed in app/api/relay/[target]/route.ts.

// ===========================================================
// Block explorer
// ===========================================================
export const EXPLORER_BASE_URL = 'https://sepolia.etherscan.io';

export function txUrl(hash: string) {
  return `${EXPLORER_BASE_URL}/tx/${hash}`;
}

export function addressUrl(address: string) {
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

// ===========================================================
// Demo mode
// ===========================================================
/**
 * Explicit demo-mode flag only.
 *
 * Whether real sweeping is possible is now a question the browser cannot
 * answer locally — the API key is server-side by design. Callers must ask the
 * relay via `isRelayConfigured()` (lib/relay.ts) instead of inspecting env.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}
