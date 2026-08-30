/**
 * lib/registry.ts
 * ----------------
 * ERC-6538 Registry interactions.
 *
 * The Registry is an on-chain mapping from EOA address → stealth meta-address.
 * Recipients register their meta-address once; senders resolve it before paying.
 */

import { type WalletClient, type PublicClient } from 'viem';
import {
  CONTRACT_ADDRESSES,
  REGISTRY_ABI,
  STEALTH_SCHEME_ID,
  createSepoliaClient,
} from './chain';

// ===========================================================
// Registration (recipient side)
// ===========================================================

/**
 * Register the recipient's stealth meta-address in the ERC-6538 Registry.
 *
 * This stores the meta-address on-chain, mapping the caller's EOA address
 * to their stealth meta-address for scheme 1 (secp256k1 + view tags).
 *
 * @param walletClient - Connected wallet client (must be signer)
 * @param metaAddress  - ERC-5564 meta-address string (st:eth:0x...)
 * @returns Transaction hash
 */
export async function registerMetaAddress(
  walletClient: WalletClient,
  metaAddress: string,
): Promise<`0x${string}`> {
  if (!walletClient.account) throw new Error('Wallet not connected');

  // Encode the meta-address as bytes for the registry.
  // Strip the "st:eth:" prefix — the registry stores the raw key bytes.
  let hex = metaAddress;
  if (hex.startsWith('st:eth:')) hex = hex.replace('st:eth:', '');
  if (!hex.startsWith('0x')) hex = `0x${hex}`;

  const metaAddressBytes = hex as `0x${string}`;

  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESSES.REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'registerKeys',
    args: [STEALTH_SCHEME_ID, metaAddressBytes],
    account: walletClient.account,
    chain: walletClient.chain,
  });

  return hash;
}

// ===========================================================
// Resolution (sender side)
// ===========================================================

/**
 * Resolve an EOA address to its registered stealth meta-address.
 *
 * Returns null if the address has not registered a meta-address.
 *
 * @param recipientAddress - The EOA address to look up
 * @param publicClient     - Optional public client (defaults to Sepolia)
 */
export async function resolveMetaAddress(
  recipientAddress: `0x${string}`,
  publicClient?: PublicClient,
): Promise<string | null> {
  const client = publicClient ?? createSepoliaClient();

  try {
    const result = await client.readContract({
      address: CONTRACT_ADDRESSES.REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'stealthMetaAddressOf',
      args: [recipientAddress, STEALTH_SCHEME_ID],
    });

    if (!result || result === '0x' || (result as string).length <= 2) return null;

    // Re-add the "st:eth:" prefix for consistency with the SDK
    return `st:eth:${result}`;
  } catch {
    return null;
  }
}

/**
 * Check whether an address has registered a stealth meta-address.
 */
export async function hasMetaAddress(
  address: `0x${string}`,
  publicClient?: PublicClient,
): Promise<boolean> {
  const result = await resolveMetaAddress(address, publicClient);
  return result !== null;
}
