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
  generateStealthMetaAddressFromKeys,
  getViewTagFromMetadata,
  isValidPublicKey,
  VALID_SCHEME_ID,
} from '@scopelift/stealth-address-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildKeyDerivationMessage,
  deriveMasterSeed,
  deriveStealthKeyBundle,
  generateRandomMasterSeed,
  KDF_VERSION,
} from './keys';
import type {
  StealthKeyBundle,
  StealthMetaAddress,
  DerivedStealthAddress,
  AnnouncementEvent,
  DetectedPayment,
} from '@/types';

// ===========================================================
// Key derivation
// ===========================================================
// Key derivation lives in lib/keys.ts: domain-separated HKDF-SHA256 over a
// master seed built from a wallet signature AND a user-held passphrase.
//
// It replaced the previous scheme, in which each private key was
// keccak256(signature over a public constant string). Under that scheme a
// signature over a publicly known fixed message was, by itself, enough to
// reconstruct both stealth private keys. It is gone; do not reintroduce it.
//
// Re-exported here so callers keep a single stealth-facing entry point.

export {
  buildKeyDerivationMessage,
  deriveMasterSeed,
  deriveStealthKeyBundle,
  generateRandomMasterSeed,
  KDF_VERSION,
};

// ===========================================================
// Meta-address encoding/decoding
// ===========================================================

/** Hex length of one COMPRESSED secp256k1 public key (33 bytes). */
const COMPRESSED_PUBKEY_HEX_LEN = 66;

/**
 * Encode spending and viewing public keys into an ERC-5564 meta-address string.
 * Format: st:eth:0x<spendingPubKey><viewingPubKey>
 *
 * Both keys MUST be COMPRESSED 33-byte secp256k1 public keys (0x02.../0x03...).
 * ERC-5564 Scheme 1 — and the ScopeLift SDK's `validateStealthMetaAddress`,
 * which only accepts a 66- or 132-hex-character payload — require this.
 * viem's `privateKeyToAccount().publicKey` is UNCOMPRESSED and must be
 * converted first (see `compressedPublicKey` in lib/keys.ts).
 */
export function encodeMetaAddress(
  spendingPublicKey: `0x${string}`,
  viewingPublicKey: `0x${string}`,
): string {
  for (const [label, key] of [
    ['spending', spendingPublicKey],
    ['viewing', viewingPublicKey],
  ] as const) {
    if (key.length !== COMPRESSED_PUBKEY_HEX_LEN + 2) {
      throw new Error(
        `Invalid ${label} public key: expected a compressed 33-byte key ` +
          `(${COMPRESSED_PUBKEY_HEX_LEN + 2} hex chars incl. 0x), got ${key.length}`,
      );
    }
    if (!isValidPublicKey(key)) {
      throw new Error(`Invalid ${label} public key: not a point on secp256k1`);
    }
  }

  // Let the SDK do the concatenation so the on-chain bytes stay canonical.
  return `st:eth:${generateStealthMetaAddressFromKeys({ spendingPublicKey, viewingPublicKey })}`;
}

/**
 * Parse a meta-address string back into its component public keys.
 * Accepts the full "st:eth:0x..." format and bare "0x..." hex.
 */
export function parseMetaAddress(metaAddress: string): StealthMetaAddress {
  let hex = metaAddress;
  if (hex.startsWith('st:eth:')) {
    hex = hex.slice('st:eth:'.length);
  }
  const keysHex = hex.startsWith('0x') ? hex.slice(2) : hex;

  // Two compressed keys = 132 hex chars. ERC-5564 also permits a single key
  // reused for both roles (66 chars); the SDK accepts that, so we do too.
  if (keysHex.length !== 132 && keysHex.length !== COMPRESSED_PUBKEY_HEX_LEN) {
    throw new Error(
      `Invalid meta-address: expected 66 or 132 hex chars of compressed keys, got ${keysHex.length}`,
    );
  }

  const spendingPublicKey = `0x${keysHex.slice(0, COMPRESSED_PUBKEY_HEX_LEN)}` as `0x${string}`;
  const viewingPublicKey =
    keysHex.length === 132
      ? (`0x${keysHex.slice(COMPRESSED_PUBKEY_HEX_LEN)}` as `0x${string}`)
      : spendingPublicKey;

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
    // ERC-5564: the view tag is byte 0 of the metadata. (Everything after it
    // is optional transfer metadata — token identifier, amount, etc.)
    const viewTagHex = getViewTagFromMetadata(announcement.metadata) as `0x${string}`;

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
 *
 * ERC-5564 metadata layout: byte 0 is the view tag; any further bytes describe
 * the transfer (token identifier, amount, ...). We publish the minimal 1-byte
 * form — the amount is deliberately left out of the announcement, since
 * putting it there would hand scanners a correlation handle for free. The
 * value is still visible in the funding transaction itself.
 */
export function encodeAnnouncerMetadata(viewTag: string | number): `0x${string}` {
  let hexTag =
    typeof viewTag === 'number'
      ? viewTag.toString(16).padStart(2, '0')
      : viewTag.replace('0x', '');
  if (hexTag.length % 2 !== 0) hexTag = `0${hexTag}`;
  if (hexTag.length !== 2) {
    throw new Error(`Invalid view tag: expected exactly 1 byte, got "${viewTag}"`);
  }
  return `0x${hexTag}` as `0x${string}`;
}
