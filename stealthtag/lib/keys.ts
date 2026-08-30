/**
 * lib/keys.ts
 * ------------
 * StealthTag key management: domain-separated HKDF derivation of the
 * ERC-5564 Scheme 1 spending and viewing keys.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The previous derivation was:
 *
 *     spendingPrivateKey = keccak256(sign("StealthTag: ...Spending Key v1"))
 *     viewingPrivateKey  = keccak256(sign("StealthTag: ...Viewing Key v1"))
 *
 * Both messages are public constants. Any dapp that can persuade the user to
 * sign those two strings reconstructs BOTH stealth private keys — a signature
 * over a publicly known fixed message was sufficient to steal all funds ever
 * sent to the user's stealth addresses. There was also no KDF: the raw
 * signature was hashed once, with no domain separation and no scalar
 * validation against the secp256k1 group order.
 *
 * ---------------------------------------------------------------------------
 * THE REPLACEMENT
 * ---------------------------------------------------------------------------
 * Two independent secrets are required to reconstruct the keys:
 *
 *   1. A wallet signature over a message bound to {version, purpose, owner,
 *      chainId}. Proves control of the EOA and is reproducible on any device.
 *   2. A user-held passphrase that NEVER appears in the signed message, is
 *      never sent to the network, and is never persisted by this module.
 *
 * They are combined once into a 32-byte master seed:
 *
 *   ikm        = signatureBytes ‖ SHA-256(domainTag ‖ passphrase)
 *   masterSeed = HKDF-SHA256(ikm, salt = SHA-256("…|master-seed"),
 *                            info = "…|master-seed|chain:<id>|owner:<addr>")
 *
 * Each key is then expanded from the master seed under its OWN info string,
 * so the spending and viewing namespaces cannot collide:
 *
 *   info = "StealthTag-KDF-v1|secp256k1|scheme:1|<domain>|chain:<id>
 *           |owner:<addr>|index:<n>|ctr:<c>"
 *
 * `ctr` supports rejection sampling: an expanded 32-byte block is only
 * accepted as a private key if it is a valid secp256k1 scalar (1 <= k < n).
 * Otherwise `ctr` is incremented and the block re-expanded, so the output
 * distribution stays uniform over the group order and derivation stays
 * deterministic.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES *NOT* DO
 * ---------------------------------------------------------------------------
 * This changes only how the two long-term secp256k1 scalars are produced. The
 * scalars are ordinary secp256k1 keys, so ERC-5564 Scheme 1 (and every
 * ScopeLift SDK call) is untouched. No new stealth-address scheme is invented
 * here, and no elliptic-curve math is hand-rolled: the SDK still owns ECDH,
 * the shared secret, the view tag, and the stealth-address derivation.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes, stringToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { generateStealthMetaAddressFromKeys } from '@scopelift/stealth-address-sdk';
import type { StealthKeyBundle } from '@/types';

// ===========================================================
// Constants
// ===========================================================

/** Version tag for the whole key-derivation scheme. Bumping this deliberately
 *  invalidates every previously derived key, so treat it as a migration. */
export const KDF_VERSION = 'StealthTag-KDF-v1';

/** The two key namespaces. They are never derived from the same info string. */
export type KeyDomain = 'spending' | 'viewing';

/** Curve order — a private key must satisfy 1 <= k < n. */
const CURVE_ORDER = secp256k1.CURVE.n;

/** Bound on rejection-sampling attempts. The probability of exhausting this is
 *  astronomically small (~2^-3800); it exists only to guarantee termination. */
const MAX_KDF_COUNTER = 16;

// ===========================================================
// Master seed
// ===========================================================

export interface MasterSeedParams {
  /** Signature over `buildKeyDerivationMessage(...)` from the owner's wallet. */
  signature: `0x${string}`;
  /** User-held secret. Required. Never included in the signed message,
   *  never transmitted, never persisted by this module. */
  passphrase: string;
  /** The EOA the keys belong to. Binds the seed to one account. */
  ownerAddress: `0x${string}`;
  /** Chain the meta-address will be registered on. Binds the seed to one chain. */
  chainId: number;
}

/**
 * The message the wallet signs. It is deliberately NOT secret: on its own a
 * signature over it is useless, because the passphrase is a separate input.
 *
 * It is still bound to version + purpose + owner + chain so a signature
 * harvested for one account or one chain cannot be replayed into another.
 */
export function buildKeyDerivationMessage(
  ownerAddress: `0x${string}`,
  chainId: number,
): string {
  return [
    `${KDF_VERSION}`,
    'purpose: derive ERC-5564 stealth spending + viewing keys',
    `owner: ${ownerAddress.toLowerCase()}`,
    `chain: ${chainId}`,
    '',
    'Signing this does not move funds.',
    'This signature alone CANNOT reconstruct your stealth keys —',
    'your StealthTag passphrase is also required.',
  ].join('\n');
}

/**
 * Combine the wallet signature and the passphrase into a 32-byte master seed.
 *
 * Deterministic by design: the same {signature, passphrase, owner, chain}
 * always yields the same seed, which is what makes stealth keys recoverable on
 * a new device without any backup file.
 */
export function deriveMasterSeed({
  signature,
  passphrase,
  ownerAddress,
  chainId,
}: MasterSeedParams): Uint8Array {
  if (!passphrase || passphrase.length === 0) {
    throw new Error(
      'A passphrase is required. Deriving stealth keys from a wallet signature alone is insecure.',
    );
  }

  const signatureBytes = hexToBytes(signature);

  // Hash the passphrase under its own domain tag before mixing it in, so the
  // raw passphrase bytes never sit adjacent to attacker-influenced data.
  const passphraseCommitment = sha256(
    concatBytes(stringToBytes(`${KDF_VERSION}|passphrase|`), stringToBytes(passphrase)),
  );

  const ikm = concatBytes(signatureBytes, passphraseCommitment);
  const salt = sha256(stringToBytes(`${KDF_VERSION}|master-seed`));
  const info = stringToBytes(
    `${KDF_VERSION}|master-seed|chain:${chainId}|owner:${ownerAddress.toLowerCase()}`,
  );

  return hkdf(sha256, ikm, salt, info, 32);
}

/**
 * A master seed with no deterministic recovery path, for users who would
 * rather back up a seed than remember a passphrase. Everything downstream of
 * the seed is identical.
 */
export function generateRandomMasterSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return seed;
}

// ===========================================================
// Domain-separated scalar derivation
// ===========================================================

export interface DomainParams {
  domain: KeyDomain;
  ownerAddress: `0x${string}`;
  chainId: number;
  /** Account index, for users who want several meta-addresses from one seed. */
  accountIndex?: number;
}

/**
 * The HKDF `info` string for one key. This is the domain separator: the
 * spending and viewing keys differ ONLY in this string, and HKDF guarantees
 * that different info strings produce independent outputs from the same seed.
 */
export function buildDomainInfo(
  { domain, ownerAddress, chainId, accountIndex = 0 }: DomainParams,
  counter: number,
): string {
  return [
    KDF_VERSION,
    'secp256k1',
    'scheme:1',
    domain,
    `chain:${chainId}`,
    `owner:${ownerAddress.toLowerCase()}`,
    `index:${accountIndex}`,
    `ctr:${counter}`,
  ].join('|');
}

/**
 * Expand one secp256k1 private key from the master seed under a domain.
 *
 * Uses rejection sampling against the curve order so the result is a uniformly
 * distributed valid scalar rather than a raw hash reduced mod n.
 */
export function deriveDomainPrivateKey(
  masterSeed: Uint8Array,
  params: DomainParams,
): `0x${string}` {
  const salt = sha256(stringToBytes(`${KDF_VERSION}|key-salt`));

  for (let counter = 0; counter < MAX_KDF_COUNTER; counter++) {
    const info = stringToBytes(buildDomainInfo(params, counter));
    const candidate = hkdf(sha256, masterSeed, salt, info, 32);
    const scalar = bytesToBigInt(candidate);
    if (scalar > 0n && scalar < CURVE_ORDER) {
      return bytesToHex(candidate) as `0x${string}`;
    }
  }

  // Unreachable in practice; never silently return an invalid key.
  throw new Error('Key derivation failed: exhausted rejection sampling counter');
}

// ===========================================================
// Bundle assembly
// ===========================================================

export interface DeriveBundleParams {
  masterSeed: Uint8Array;
  ownerAddress: `0x${string}`;
  chainId: number;
  accountIndex?: number;
}

/**
 * Derive the recipient's full stealth key bundle from a master seed.
 *
 * Public keys are COMPRESSED (33 bytes, `0x02…`/`0x03…`) because that is what
 * ERC-5564 Scheme 1 and the ScopeLift SDK's meta-address format require.
 */
export function deriveStealthKeyBundle({
  masterSeed,
  ownerAddress,
  chainId,
  accountIndex = 0,
}: DeriveBundleParams): StealthKeyBundle {
  if (masterSeed.length !== 32) {
    throw new Error(`Master seed must be 32 bytes, got ${masterSeed.length}`);
  }

  const spendingPrivateKey = deriveDomainPrivateKey(masterSeed, {
    domain: 'spending',
    ownerAddress,
    chainId,
    accountIndex,
  });
  const viewingPrivateKey = deriveDomainPrivateKey(masterSeed, {
    domain: 'viewing',
    ownerAddress,
    chainId,
    accountIndex,
  });

  const spendingPublicKey = compressedPublicKey(spendingPrivateKey);
  const viewingPublicKey = compressedPublicKey(viewingPrivateKey);

  // Canonical ERC-5564 meta-address bytes, built by the SDK (it validates both
  // keys as points on the curve before concatenating).
  const metaAddressHex = generateStealthMetaAddressFromKeys({
    spendingPublicKey,
    viewingPublicKey,
  });

  return {
    spendingPrivateKey,
    spendingPublicKey,
    viewingPrivateKey,
    viewingPublicKey,
    metaAddress: `st:eth:${metaAddressHex}`,
    ownerAddress,
    chainId,
    accountIndex,
  };
}

/**
 * Compressed secp256k1 public key (33 bytes) for a private key.
 * Note: viem's `privateKeyToAccount().publicKey` is UNCOMPRESSED (65 bytes)
 * and is NOT interchangeable with this.
 */
export function compressedPublicKey(privateKey: `0x${string}`): `0x${string}` {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true)) as `0x${string}`;
}

/** The EOA address controlled by a derived private key (used in tests/UI). */
export function addressForPrivateKey(privateKey: `0x${string}`): `0x${string}` {
  return privateKeyToAccount(privateKey).address;
}

// ===========================================================
// Small byte helpers
// ===========================================================

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}
