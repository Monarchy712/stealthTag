/**
 * lib/announcer.ts
 * -----------------
 * ERC-5564 Announcer interactions.
 *
 * The Announcer stores announcements (ephemeral pubkey + metadata/view tag)
 * that let the recipient scan for incoming payments efficiently.
 *
 * Sender calls: announce(schemeId, stealthAddress, ephemeralPubKey, metadata)
 * Recipient scans: getLogs for Announcement events, then filters with view tag + detection.
 */

import { type WalletClient, type PublicClient, parseEventLogs } from 'viem';
import {
  CONTRACT_ADDRESSES,
  ANNOUNCER_ABI,
  STEALTH_SCHEME_ID,
  createSepoliaClient,
} from './chain';
import { encodeAnnouncerMetadata } from './stealth';
import type { AnnouncementEvent } from '@/types';

// ===========================================================
// Announce (sender side)
// ===========================================================

/**
 * Publish an announcement to the ERC-5564 Announcer.
 *
 * Must be called AFTER the funds have been sent to the stealth address.
 * This lets the recipient's scanner know that a payment exists at that address.
 *
 * @param walletClient     - Connected wallet (signer)
 * @param stealthAddress   - The one-time stealth address funds were sent to
 * @param ephemeralPublicKey - The ephemeral public key (65 bytes, hex)
 * @param viewTag          - View tag byte (0-255) for cheap pre-filtering
 */
export async function publishAnnouncement(
  walletClient: WalletClient,
  stealthAddress: `0x${string}`,
  ephemeralPublicKey: `0x${string}`,
  viewTag: string | number,
): Promise<`0x${string}`> {
  if (!walletClient.account) throw new Error('Wallet not connected');

  // Metadata format for scheme 1: 0x01<viewTag>
  const metadata = encodeAnnouncerMetadata(viewTag);

  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESSES.ANNOUNCER,
    abi: ANNOUNCER_ABI,
    functionName: 'announce',
    args: [STEALTH_SCHEME_ID, stealthAddress, ephemeralPublicKey, metadata],
    account: walletClient.account,
    chain: walletClient.chain,
  });

  return hash;
}

// ===========================================================
// Scan announcements (recipient side)
// ===========================================================

const DEFAULT_FROM_BLOCK = BigInt(0);
const MAX_BLOCK_RANGE = BigInt(2000); // Limit range to avoid RPC rate limits

/**
 * Fetch all Announcement events from the ERC-5564 Announcer.
 *
 * Returns raw events — callers should then run view-tag filtering
 * and full detection using lib/stealth.ts#scanAnnouncements.
 *
 * @param fromBlock    - Start scanning from this block (default: 0)
 * @param toBlock      - End scanning at this block (default: 'latest')
 * @param publicClient - Optional public client
 */
export async function fetchAnnouncements(
  fromBlock: bigint = DEFAULT_FROM_BLOCK,
  toBlock: bigint | 'latest' = 'latest',
  publicClient?: PublicClient,
): Promise<AnnouncementEvent[]> {
  const client = publicClient ?? createSepoliaClient();

  try {
    const logs = await client.getLogs({
      address: CONTRACT_ADDRESSES.ANNOUNCER,
      event: ANNOUNCER_ABI[1], // Announcement event
      fromBlock,
      toBlock,
    });

    return logs.map((log) => ({
      schemeId: (log.args as any).schemeId ?? STEALTH_SCHEME_ID,
      stealthAddress: (log.args as any).stealthAddress as `0x${string}`,
      ephemeralPubKey: (log.args as any).ephemeralPubKey as `0x${string}`,
      metadata: (log.args as any).metadata as `0x${string}`,
      blockNumber: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash as `0x${string}`,
      caller: (log.args as any).caller as `0x${string}`,
    }));
  } catch (err) {
    console.error('Failed to fetch announcements:', err);
    return [];
  }
}

/**
 * Fetch the latest block number (used to limit scan range).
 */
export async function getLatestBlock(publicClient?: PublicClient): Promise<bigint> {
  const client = publicClient ?? createSepoliaClient();
  const block = await client.getBlockNumber();
  return block;
}
