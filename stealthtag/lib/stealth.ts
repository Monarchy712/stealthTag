/**
 * lib/stealth.ts
 * ---------------
 * ERC-5564 stealth address derivation and detection.
 *
 * We use the ScopeLift `@scopelift/stealth-address-sdk` for all
 * elliptic-curve math — do NOT hand-roll ECDH.
 *
 * Key concepts:
 *  - Meta-address: spending_pubkey + viewing_pubkey (what you publish)
 *  - Stealth address: ECDH-derived one-time address per payment
 *  - View tag: 1-byte prefix that lets recipients pre-filter ~256x cheaper
 *  - Ephemeral key: sender's random key, published in the announcement
 */

import {
  generateStealthAddress,
  checkStealthAddress,
  computeStealthKey,
  parseStealthMetaAddressURI,
  VALID_SCHEME_ID,
} from '@scopelift/stealth-address-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, hexToBytes, toHex } from 'viem';
import type {
  StealthKeyBundle,
  StealthMetaAddress,
  DerivedStealthAddress,
  AnnouncementEvent,
  DetectedPayment,
} from '@/types';

// ===========================================================
// Key derivation from wallet signature
// ===========================================================
// We derive deterministic spending and viewing keys by signing
// a domain-specific message with the user's EOA wallet.
// This means the user never needs to separately back up stealth keys —
// they can always regenerate them by signing with their wallet.

const SPENDING_KEY_MESSAGE = 'StealthTag: Generate Stealth Spending Key v1';
const VIEWING_KEY_MESSAGE = 'StealthTag: Generate Stealth Viewing Key v1';

/**
 * Derive a private key from a wallet signature.
 * The signature is hashed to produce a 32-byte private key.
 * This is deterministic: same wallet + same message → same key.
 */
function deriveKeyFromSignature(signature: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(['bytes'], [signature]));
}

/**
 * Generate the full stealth key bundle for a recipient.
 *
 * Requires two signatures from the user's wallet (one for spending key,
 * one for viewing key). The user signs well-known messages — no funds at risk.
 *
 * @param ownerAddress - The EOA address of the recipient
 * @param spendingSignature - Signature over SPENDING_KEY_MESSAGE
 * @param viewingSignature  - Signature over VIEWING_KEY_MESSAGE
 */
export function generateStealthKeyBundle(
  ownerAddress: `0x${string}`,
  spendingSignature: `0x${string}`,
  viewingSignature: `0x${string}`,
): StealthKeyBundle {
  const spendingPrivateKey = deriveKeyFromSignature(spendingSignature);
  const viewingPrivateKey = deriveKeyFromSignature(viewingSignature);

  const spendingAccount = privateKeyToAccount(spendingPrivateKey);
  const viewingAccount = privateKeyToAccount(viewingPrivateKey);

  const spendingPublicKey = spendingAccount.publicKey;
  const viewingPublicKey = viewingAccount.publicKey;

  // ERC-5564 meta-address format: spending pubkey + viewing pubkey
  // The SDK encodes this as: st:eth:0x<spendingPubKey><viewingPubKey>
  const metaAddress = encodeMetaAddress(spendingPublicKey, viewingPublicKey);

  return {
    spendingPrivateKey,
    spendingPublicKey,
    viewingPrivateKey,
    viewingPublicKey,
    metaAddress,
    ownerAddress,
  };
}

/**
 * The messages the user needs to sign (export for use in UI).
 */
export const STEALTH_KEY_MESSAGES = {
  spending: SPENDING_KEY_MESSAGE,
  viewing: VIEWING_KEY_MESSAGE,
} as const;

// ===========================================================
// Meta-address encoding/decoding
// ===========================================================

/**
 * Encode spending and viewing public keys into an ERC-5564 meta-address string.
 * Format: st:eth:0x<spendingPubKey><viewingPubKey>
 * Both keys are uncompressed 65-byte secp256k1 public keys (04...).
 */
export function encodeMetaAddress(
  spendingPublicKey: `0x${string}`,
  viewingPublicKey: `0x${string}`,
): string {
  const spendingHex = spendingPublicKey.replace('0x', '');
  const viewingHex = viewingPublicKey.replace('0x', '');
  return `st:eth:0x${spendingHex}${viewingHex}`;
}

/**
 * Parse a meta-address string back into its component public keys.
 * Accepts both the full "st:eth:0x..." format and bare "0x..." hex.
 */
export function parseMetaAddress(metaAddress: string): StealthMetaAddress {
  let hex = metaAddress;
  if (hex.startsWith('st:eth:')) {
    hex = hex.replace('st:eth:', '');
  }
  if (!hex.startsWith('0x')) {
    hex = `0x${hex}`;
  }

  // Each uncompressed public key is 65 bytes = 130 hex chars
  const keysHex = hex.replace('0x', '');
  if (keysHex.length < 260) {
    throw new Error('Invalid meta-address: too short');
  }

  const spendingPublicKey = `0x${keysHex.slice(0, 130)}` as `0x${string}`;
  const viewingPublicKey = `0x${keysHex.slice(130, 260)}` as `0x${string}`;

  return {
    metaAddress,
    spendingPublicKey,
    viewingPublicKey,
  };
}

// ===========================================================
// Sender: derive a one-time stealth address
// ===========================================================

/**
 * Derive a unique one-time stealth address for a given recipient meta-address.
 *
 * This is what the sender calls before sending funds. Each call produces
 * a distinct address even for the same recipient — unlinkable on-chain.
 *
 * @param metaAddress - Recipient's published ERC-5564 meta-address string
 */
export function deriveStealthAddress(metaAddress: string): DerivedStealthAddress {
  const normalizedUri = metaAddress.startsWith('st:eth:') ? metaAddress : `st:eth:${metaAddress}`;
  
  const result = generateStealthAddress({
    stealthMetaAddressURI: normalizedUri,
    schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
  });

  return {
    stealthAddress: result.stealthAddress as `0x${string}`,
    ephemeralPublicKey: result.ephemeralPublicKey as `0x${string}`,
    viewTag: result.viewTag,
  };
}

// ===========================================================
// Recipient: detect if an announcement belongs to them
// ===========================================================

/**
 * Check whether a given announcement event belongs to this recipient.
 *
 * Uses the viewing key (NOT the spending key — safer) to:
 *   1. Recompute the ECDH shared secret using the ephemeral pubkey from the announcement
 *   2. Check the view tag (first byte) — if it doesn't match, skip immediately (256× speedup)
 *   3. If view tag matches, reconstruct the stealth address and confirm it matches
 *
 * @param announcement - Raw event from the ERC-5564 Announcer
 * @param keyBundle - The recipient's stealth key bundle
 * @returns DetectedPayment if this announcement belongs to the recipient, null otherwise
 */
export function detectPayment(
  announcement: AnnouncementEvent,
  keyBundle: StealthKeyBundle,
): DetectedPayment | null {
  try {
    const metadata = announcement.metadata;
    const metadataBytes = hexToBytes(metadata);

    // The view tag is at byte index 1 (byte 0 is the scheme indicator/version)
    const announcedViewTagByte = metadataBytes.length > 1 ? metadataBytes[1] : metadataBytes[0];
    const viewTagHex = `0x${announcedViewTagByte.toString(16).padStart(2, '0')}` as `0x${string}`;

    // Use the SDK to check if this announcement belongs to us
    const isMatch = checkStealthAddress({
      userStealthAddress: announcement.stealthAddress,
      ephemeralPublicKey: announcement.ephemeralPubKey,
      viewingPrivateKey: keyBundle.viewingPrivateKey,
      spendingPublicKey: keyBundle.spendingPublicKey,
      viewTag: viewTagHex,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    });

    if (!isMatch) return null;

    // Compute the spending key for this stealth address
    const stealthPrivateKey = computeStealthKey({
      ephemeralPublicKey: announcement.ephemeralPubKey,
      spendingPrivateKey: keyBundle.spendingPrivateKey,
      viewingPrivateKey: keyBundle.viewingPrivateKey,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
    }) as `0x${string}`;

    // Correctness gate: assert recomputed stealth private key generates the exact announced stealth address
    const derivedAccount = privateKeyToAccount(stealthPrivateKey);
    if (derivedAccount.address.toLowerCase() !== announcement.stealthAddress.toLowerCase()) {
      return null;
    }

    return {
      stealthAddress: announcement.stealthAddress,
      stealthPrivateKey,
      ephemeralPublicKey: announcement.ephemeralPubKey,
      blockNumber: announcement.blockNumber,
      transactionHash: announcement.transactionHash,
      swept: false,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Batch-detect announcements for a recipient.
 * Returns all DetectedPayments belonging to the given key bundle.
 *
 * @param announcements - Raw announcement events from the Announcer
 * @param keyBundle - The recipient's stealth key bundle
 */
export function scanAnnouncements(
  announcements: AnnouncementEvent[],
  keyBundle: StealthKeyBundle,
): DetectedPayment[] {
  const detected: DetectedPayment[] = [];
  for (const ann of announcements) {
    const payment = detectPayment(ann, keyBundle);
    if (payment) detected.push(payment);
  }
  return detected;
}

/**
 * Encode a view tag as the metadata bytes for the ERC-5564 Announcer.
 * Scheme 1 metadata format: 0x01<viewTag>
 */
export function encodeAnnouncerMetadata(viewTag: string | number): `0x${string}` {
  let hexTag = typeof viewTag === 'number' ? viewTag.toString(16).padStart(2, '0') : viewTag.replace('0x', '');
  if (hexTag.length % 2 !== 0) hexTag = '0' + hexTag;
  return `0x01${hexTag}` as `0x${string}`;
}
