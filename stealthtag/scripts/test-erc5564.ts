/**
 * scripts/test-erc5564.ts
 * -----------------------
 * Verification script for Milestone 1: ERC-5564 stealth address generation,
 * view-tag filtering, announcement parsing, and cryptographic correctness gate.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  generateStealthAddress,
  checkStealthAddress,
  computeStealthKey,
  VALID_SCHEME_ID,
} from '@scopelift/stealth-address-sdk';
import { encodeMetaAddress, detectPayment } from '../lib/stealth';
import type { StealthKeyBundle, AnnouncementEvent } from '../types';

async function runTest() {
  console.log('=== MILESTONE 1: REAL ERC-5564 CRYPTOGRAPHY VERIFICATION ===\n');

  // 1. Recipient Key Setup
  const spendPriv = generatePrivateKey();
  const viewPriv = generatePrivateKey();
  const spendAcc = privateKeyToAccount(spendPriv);
  const viewAcc = privateKeyToAccount(viewPriv);

  const metaAddress = encodeMetaAddress(spendAcc.publicKey, viewAcc.publicKey);
  console.log('1. Recipient Meta-Address:');
  console.log('   Spending PubKey:', spendAcc.publicKey.slice(0, 30) + '...');
  console.log('   Viewing PubKey: ', viewAcc.publicKey.slice(0, 30) + '...');
  console.log('   Meta-Address:   ', metaAddress);

  const recipientBundle: StealthKeyBundle = {
    spendingPrivateKey: spendPriv,
    spendingPublicKey: spendAcc.publicKey,
    viewingPrivateKey: viewPriv,
    viewingPublicKey: viewAcc.publicKey,
    metaAddress,
    ownerAddress: spendAcc.address,
  };

  // 2. Sender Derivation (ECDH)
  console.log('\n2. Sender Deriving Stealth Address for Recipient...');
  const genResult = generateStealthAddress({
    stealthMetaAddressURI: metaAddress,
    schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
  });

  console.log('   Derived Stealth Address:', genResult.stealthAddress);
  console.log('   Ephemeral Public Key:   ', genResult.ephemeralPublicKey.slice(0, 30) + '...');
  console.log('   View Tag:               ', genResult.viewTag);

  // 3. Sender Publishes Announcement
  const announcement: AnnouncementEvent = {
    schemeId: 1n,
    stealthAddress: genResult.stealthAddress as `0x${string}`,
    ephemeralPubKey: genResult.ephemeralPublicKey as `0x${string}`,
    metadata: `0x01${genResult.viewTag.replace('0x', '')}` as `0x${string}`,
    blockNumber: 7100000n,
    transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    caller: '0x2222222222222222222222222222222222222222',
  };

  // 4. Recipient Scans & Detects
  console.log('\n3. Recipient Scanning Announcement with Viewing Key & View Tag...');
  const detected = detectPayment(announcement, recipientBundle);

  if (!detected) {
    throw new Error('FAIL: Payment was not detected by recipient!');
  }
  console.log('   ✓ Match confirmed!');
  console.log('   Detected Stealth Address:', detected.stealthAddress);
  console.log('   Computed Stealth Private Key:', detected.stealthPrivateKey.slice(0, 20) + '...');

  // 5. Correctness Gate Verification
  const signerFromStealthKey = privateKeyToAccount(detected.stealthPrivateKey);
  console.log('   Signer address from computed private key:', signerFromStealthKey.address);
  
  if (signerFromStealthKey.address.toLowerCase() !== genResult.stealthAddress.toLowerCase()) {
    throw new Error('FAIL: Correctness gate failed! Computed private key does not match stealth address.');
  }
  console.log('   ✓ Correctness Gate Passed: Recomputed private key controls the exact stealth address.');

  // 6. Negative Test (Announcement for another user)
  console.log('\n4. Negative Test: Scanning Announcement for a Different Recipient...');
  const otherViewPriv = generatePrivateKey();
  const otherSpendPriv = generatePrivateKey();
  const otherRecipient: StealthKeyBundle = {
    spendingPrivateKey: otherSpendPriv,
    spendingPublicKey: privateKeyToAccount(otherSpendPriv).publicKey,
    viewingPrivateKey: otherViewPriv,
    viewingPublicKey: privateKeyToAccount(otherViewPriv).publicKey,
    metaAddress: 'st:eth:0x...',
    ownerAddress: privateKeyToAccount(otherSpendPriv).address,
  };

  const rejectedMatch = detectPayment(announcement, otherRecipient);
  if (rejectedMatch !== null) {
    throw new Error('FAIL: Other recipient mistakenly detected a payment not intended for them!');
  }
  console.log('   ✓ Successfully rejected non-matching announcement via view tag / checkStealthAddress.');

  console.log('\n=== ALL ERC-5564 CRYPTOGRAPHIC GATES PASSED 100% ===');
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
