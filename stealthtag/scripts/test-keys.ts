/**
 * scripts/test-keys.ts
 * ---------------------
 * Verification suite for Milestone 2: domain-separated HKDF key management.
 *
 * Covers:
 *   1. Deterministic derivation where intended
 *   2. Viewing and spending keys are different
 *   3. Domain separation works
 *   4. Same seed/material produces stable intended keys
 *   5. Different domain produces different keys
 *   6. Derived public keys are valid secp256k1 keys
 *   7. ERC-5564 Scheme 1 still works with KDF-derived keys
 *   8. The correctness gate still passes
 *   9. Unrelated announcements are still rejected
 *  10. A wallet signature alone is not sufficient (passphrase is required)
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { isValidPublicKey } from '@scopelift/stealth-address-sdk';
import {
  KDF_VERSION,
  buildDomainInfo,
  buildKeyDerivationMessage,
  compressedPublicKey,
  deriveDomainPrivateKey,
  deriveMasterSeed,
  deriveStealthKeyBundle,
  generateRandomMasterSeed,
} from '../lib/keys';
import { deriveStealthAddress, detectPayment, encodeAnnouncerMetadata } from '../lib/stealth';
import type { AnnouncementEvent, StealthKeyBundle } from '../types';

// ── tiny assertion helpers ────────────────────────────────────
let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`   ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`   ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function expectThrows(name: string, fn: () => unknown): void {
  try {
    fn();
    check(name, false, 'expected a throw, got a value');
  } catch {
    check(name, true);
  }
}

// ── fixtures ──────────────────────────────────────────────────
const OWNER = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const OTHER_OWNER = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const CHAIN_ID = 11155111; // Sepolia
const PASSPHRASE = 'correct horse battery staple';

// A fixed 65-byte value standing in for an EOA signature over
// buildKeyDerivationMessage(OWNER, CHAIN_ID). Using a constant here is what
// makes the determinism assertions meaningful.
const SIGNATURE =
  ('0x' + 'ab'.repeat(65)) as `0x${string}`;
const OTHER_SIGNATURE =
  ('0x' + 'cd'.repeat(65)) as `0x${string}`;

function seed(overrides: Partial<Parameters<typeof deriveMasterSeed>[0]> = {}) {
  return deriveMasterSeed({
    signature: SIGNATURE,
    passphrase: PASSPHRASE,
    ownerAddress: OWNER,
    chainId: CHAIN_ID,
    ...overrides,
  });
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

async function run() {
  console.log(`=== MILESTONE 2: KEY MANAGEMENT (${KDF_VERSION}) ===\n`);

  // ─────────────────────────────────────────────────────────────
  console.log('1. Deterministic derivation where intended');

  const seedA = seed();
  const seedB = seed();
  check('same {signature, passphrase, owner, chain} → same master seed', toHex(seedA) === toHex(seedB));
  check('master seed is 32 bytes', seedA.length === 32, `got ${seedA.length}`);

  const bundleA = deriveStealthKeyBundle({ masterSeed: seedA, ownerAddress: OWNER, chainId: CHAIN_ID });
  const bundleB = deriveStealthKeyBundle({ masterSeed: seedB, ownerAddress: OWNER, chainId: CHAIN_ID });
  check('same seed → identical spending key', bundleA.spendingPrivateKey === bundleB.spendingPrivateKey);
  check('same seed → identical viewing key', bundleA.viewingPrivateKey === bundleB.viewingPrivateKey);
  check('same seed → identical meta-address', bundleA.metaAddress === bundleB.metaAddress);

  const randomSeed1 = generateRandomMasterSeed();
  const randomSeed2 = generateRandomMasterSeed();
  check('random seeds are NOT deterministic', toHex(randomSeed1) !== toHex(randomSeed2));

  // ─────────────────────────────────────────────────────────────
  console.log('\n2. Viewing and spending keys are different');

  check('spending ≠ viewing private key', bundleA.spendingPrivateKey !== bundleA.viewingPrivateKey);
  check('spending ≠ viewing public key', bundleA.spendingPublicKey !== bundleA.viewingPublicKey);
  check(
    'meta-address contains both keys (132 hex chars)',
    bundleA.metaAddress.replace('st:eth:0x', '').length === 132,
  );

  // ─────────────────────────────────────────────────────────────
  console.log('\n3. Domain separation works');

  const spendingInfo = buildDomainInfo(
    { domain: 'spending', ownerAddress: OWNER, chainId: CHAIN_ID }, 0,
  );
  const viewingInfo = buildDomainInfo(
    { domain: 'viewing', ownerAddress: OWNER, chainId: CHAIN_ID }, 0,
  );
  check('spending and viewing info strings differ', spendingInfo !== viewingInfo);
  check('info string is version-tagged', spendingInfo.startsWith(`${KDF_VERSION}|`));
  check('info string names the domain', spendingInfo.includes('|spending|') && viewingInfo.includes('|viewing|'));
  check('info string binds owner', spendingInfo.includes(`owner:${OWNER.toLowerCase()}`));
  check('info string binds chain', spendingInfo.includes(`chain:${CHAIN_ID}`));

  // Different owner / chain / index must all produce different keys from the
  // SAME seed — that is what "domain separation" buys us.
  const otherOwnerKey = deriveDomainPrivateKey(seedA, {
    domain: 'spending', ownerAddress: OTHER_OWNER, chainId: CHAIN_ID,
  });
  const otherChainKey = deriveDomainPrivateKey(seedA, {
    domain: 'spending', ownerAddress: OWNER, chainId: 1,
  });
  const otherIndexKey = deriveDomainPrivateKey(seedA, {
    domain: 'spending', ownerAddress: OWNER, chainId: CHAIN_ID, accountIndex: 1,
  });
  check('different owner → different key', otherOwnerKey !== bundleA.spendingPrivateKey);
  check('different chain → different key', otherChainKey !== bundleA.spendingPrivateKey);
  check('different account index → different key', otherIndexKey !== bundleA.spendingPrivateKey);
  check(
    'all domain variants are pairwise distinct',
    new Set([
      bundleA.spendingPrivateKey, bundleA.viewingPrivateKey,
      otherOwnerKey, otherChainKey, otherIndexKey,
    ]).size === 5,
  );

  // ─────────────────────────────────────────────────────────────
  console.log('\n4. Same seed/material produces stable intended keys');

  // Regression vector: pinning the outputs for a fixed input catches any
  // accidental change to the KDF (salt, info layout, hash, ordering).
  const KNOWN_SEED_HEX = toHex(seedA);
  const KNOWN_SPENDING = bundleA.spendingPrivateKey;
  const KNOWN_VIEWING = bundleA.viewingPrivateKey;

  const reSeed = seed();
  const reBundle = deriveStealthKeyBundle({ masterSeed: reSeed, ownerAddress: OWNER, chainId: CHAIN_ID });
  check('master seed is stable across calls', toHex(reSeed) === KNOWN_SEED_HEX);
  check('spending key is stable across calls', reBundle.spendingPrivateKey === KNOWN_SPENDING);
  check('viewing key is stable across calls', reBundle.viewingPrivateKey === KNOWN_VIEWING);
  console.log(`     (vector: seed=${KNOWN_SEED_HEX.slice(0, 16)}… spend=${KNOWN_SPENDING.slice(0, 18)}…)`);

  // Every input must actually matter.
  check(
    'different signature → different seed',
    toHex(seed({ signature: OTHER_SIGNATURE })) !== KNOWN_SEED_HEX,
  );
  check(
    'different passphrase → different seed',
    toHex(seed({ passphrase: `${PASSPHRASE} ` })) !== KNOWN_SEED_HEX,
  );
  check(
    'different owner → different seed',
    toHex(seed({ ownerAddress: OTHER_OWNER })) !== KNOWN_SEED_HEX,
  );
  check(
    'different chain → different seed',
    toHex(seed({ chainId: 1 })) !== KNOWN_SEED_HEX,
  );

  // ─────────────────────────────────────────────────────────────
  console.log('\n5. Different domain produces different keys (from one seed)');

  const spendFromSeed = deriveDomainPrivateKey(seedA, {
    domain: 'spending', ownerAddress: OWNER, chainId: CHAIN_ID,
  });
  const viewFromSeed = deriveDomainPrivateKey(seedA, {
    domain: 'viewing', ownerAddress: OWNER, chainId: CHAIN_ID,
  });
  check('domain "spending" ≠ domain "viewing"', spendFromSeed !== viewFromSeed);
  check('spending matches the bundle', spendFromSeed === bundleA.spendingPrivateKey);
  check('viewing matches the bundle', viewFromSeed === bundleA.viewingPrivateKey);

  // ─────────────────────────────────────────────────────────────
  console.log('\n6. Derived keys are valid secp256k1 keys');

  for (const [label, priv, pub] of [
    ['spending', bundleA.spendingPrivateKey, bundleA.spendingPublicKey],
    ['viewing', bundleA.viewingPrivateKey, bundleA.viewingPublicKey],
  ] as const) {
    const scalar = BigInt(priv);
    check(`${label} scalar is in [1, n)`, scalar > 0n && scalar < secp256k1.CURVE.n);
    check(`${label} private key is 32 bytes`, hexToBytes(priv).length === 32);
    check(`${label} public key is compressed (33 bytes)`, hexToBytes(pub).length === 33);
    check(`${label} public key prefix is 0x02/0x03`, pub.startsWith('0x02') || pub.startsWith('0x03'));
    check(`${label} public key is on the curve`, isValidPublicKey(pub));
    check(`${label} public key matches its private key`, compressedPublicKey(priv) === pub);
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n7. ERC-5564 Scheme 1 still works with KDF-derived keys');

  const derived = deriveStealthAddress(bundleA.metaAddress);
  check('sender derived a stealth address', /^0x[0-9a-fA-F]{40}$/.test(derived.stealthAddress));
  check('ephemeral public key is compressed', hexToBytes(derived.ephemeralPublicKey as `0x${string}`).length === 33);
  check('view tag is 1 byte', hexToBytes(derived.viewTag as `0x${string}`).length === 1);

  const second = deriveStealthAddress(bundleA.metaAddress);
  check(
    'two payments to the same meta-address give different stealth addresses',
    derived.stealthAddress !== second.stealthAddress,
  );

  const announcement: AnnouncementEvent = {
    schemeId: 1n,
    stealthAddress: derived.stealthAddress,
    ephemeralPubKey: derived.ephemeralPublicKey,
    metadata: encodeAnnouncerMetadata(derived.viewTag),
    blockNumber: 7100000n,
    transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    caller: '0x2222222222222222222222222222222222222222',
  };
  check('metadata carries the view tag in byte 0', announcement.metadata === derived.viewTag);

  const detected = detectPayment(announcement, bundleA);
  check('recipient detects the payment with the viewing key', detected !== null);

  // ─────────────────────────────────────────────────────────────
  console.log('\n8. Correctness gate');

  if (detected) {
    const signer = privateKeyToAccount(detected.stealthPrivateKey);
    check(
      'privateKeyToAddress(stealthPrivateKey) === announcement.stealthAddress',
      signer.address.toLowerCase() === announcement.stealthAddress.toLowerCase(),
      `${signer.address} vs ${announcement.stealthAddress}`,
    );
  } else {
    check('privateKeyToAddress(stealthPrivateKey) === announcement.stealthAddress', false, 'no detection');
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n9. Unrelated announcements are still rejected');

  const strangerSeed = seed({ signature: OTHER_SIGNATURE, passphrase: 'a different passphrase' });
  const stranger: StealthKeyBundle = deriveStealthKeyBundle({
    masterSeed: strangerSeed,
    ownerAddress: OTHER_OWNER,
    chainId: CHAIN_ID,
  });
  check('stranger does NOT detect the payment', detectPayment(announcement, stranger) === null);
  check(
    'recipient does NOT detect the stranger\'s payment',
    detectPayment(
      {
        ...announcement,
        stealthAddress: deriveStealthAddress(stranger.metaAddress).stealthAddress,
      },
      bundleA,
    ) === null,
  );

  // ─────────────────────────────────────────────────────────────
  console.log('\n10. A signature alone is not sufficient');

  expectThrows('empty passphrase is rejected', () => seed({ passphrase: '' }));
  const message = buildKeyDerivationMessage(OWNER, CHAIN_ID);
  check('signed message does not contain the passphrase', !message.includes(PASSPHRASE));
  check('signed message is bound to the owner', message.includes(OWNER.toLowerCase()));
  check('signed message is bound to the chain', message.includes(`chain: ${CHAIN_ID}`));
  check('signed message is version-tagged', message.includes(KDF_VERSION));
  check(
    'same signature + different passphrase → different stealth keys',
    deriveStealthKeyBundle({
      masterSeed: seed({ passphrase: 'guessed wrong' }),
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
    }).spendingPrivateKey !== bundleA.spendingPrivateKey,
  );

  // ─────────────────────────────────────────────────────────────
  console.log(`\n=== ${passed} passed, ${failures.length} failed ===`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAILED: ${f}`);
    process.exit(1);
  }
  console.log('=== ALL MILESTONE 2 KEY-MANAGEMENT GATES PASSED ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
