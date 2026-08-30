/**
 * scripts/test-sweep-local.ts
 * ----------------------------
 * LOCAL TEST — end-to-end stealth sweep against a real EVM.
 *
 * Runs against `anvil --fork-url <sepolia> --hardfork prague`, so the real
 * Sepolia EntryPoint v0.8 and the real Simple7702Account implementation are
 * present, and EIP-7702 (Prague) is active. Nothing is mocked: real ERC-5564
 * derivation, a real transfer, a real EIP-7702 authorization, a real
 * PackedUserOperation, and a real `EntryPoint.handleOps` execution.
 *
 * WHAT IS AND IS NOT COVERED
 *   LOCAL     — everything below: funding, detection, 7702 delegation, UserOp
 *               construction, signature validation, execution, destination
 *               receipt, and the negative cases.
 *   MOCK      — the bundler role is played by a funded anvil account calling
 *               handleOps directly. That is what a bundler does; there is no
 *               bundler *service* here.
 *   UNVERIFIED— Paymaster sponsorship. Requires a funded paymaster and a live
 *               Pimlico key; see scripts/test-relay.ts and the Milestone 3
 *               report. This script exercises the SELF-FUNDED gas path.
 *
 * Start the chain first:
 *   anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com \
 *         --port 8545 --hardfork prague
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  parseEther,
  type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  entryPoint08Abi,
  entryPoint08Address,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from 'viem/account-abstraction';
import { to7702SimpleSmartAccount } from 'permissionless/accounts';
import { deriveStealthKeyBundle } from '../lib/keys';
import { deriveStealthAddress, detectPayment, encodeAnnouncerMetadata } from '../lib/stealth';
import { EIP7702_IMPLEMENTATION, assertAccountIsStealthAddress } from '../lib/smartAccount';
import type { AnnouncementEvent } from '../types';

const ANVIL_URL = process.env.ANVIL_URL ?? 'http://127.0.0.1:8545';

/** Well-known anvil dev keys. Test-only, funded by anvil, never real funds. */
const SENDER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const BUNDLER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

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

async function expectRevert(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(name, false, 'expected a revert, call succeeded');
  } catch {
    check(name, true);
  }
}

async function run() {
  console.log('=== MILESTONE 3: LOCAL END-TO-END SWEEP (anvil fork, EIP-7702) ===\n');

  const publicClient = createPublicClient({ chain: sepolia, transport: http(ANVIL_URL) });

  try {
    await publicClient.getBlockNumber();
  } catch {
    console.error(
      `\nCannot reach anvil at ${ANVIL_URL}.\n` +
        'Start it with:\n' +
        '  anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --port 8545 --hardfork prague\n',
    );
    process.exit(1);
  }

  // ── 0. Preconditions ────────────────────────────────────────
  console.log('0. Chain preconditions');
  const epCode = await publicClient.getCode({ address: entryPoint08Address });
  const implCode = await publicClient.getCode({ address: EIP7702_IMPLEMENTATION });
  check('EntryPoint v0.8 is deployed', !!epCode && epCode !== '0x');
  check('Simple7702Account implementation is deployed', !!implCode && implCode !== '0x');

  const senderWallet = createWalletClient({
    account: privateKeyToAccount(SENDER_KEY),
    chain: sepolia,
    transport: http(ANVIL_URL),
  });
  const bundlerAccount = privateKeyToAccount(BUNDLER_KEY);
  const bundlerWallet = createWalletClient({
    account: bundlerAccount,
    chain: sepolia,
    transport: http(ANVIL_URL),
  });

  // ── 1. Recipient identity (Milestone 2 KDF) ─────────────────
  console.log('\n1. Recipient identity');
  const masterSeed = new Uint8Array(32).fill(0x11);
  const recipient = deriveStealthKeyBundle({
    masterSeed,
    ownerAddress: '0x000000000000000000000000000000000000bEEF',
    chainId: sepolia.id,
  });
  check('meta-address derived from the HKDF bundle', recipient.metaAddress.startsWith('st:eth:0x'));

  // ── 2. Sender pays the stealth address ──────────────────────
  console.log('\n2. Stealth address receives funds');
  const derived = deriveStealthAddress(recipient.metaAddress);
  const stealthAddress = derived.stealthAddress;

  const PAYMENT = parseEther('0.05');
  const fundHash = await senderWallet.sendTransaction({
    to: stealthAddress,
    value: PAYMENT,
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  const stealthBalance = await publicClient.getBalance({ address: stealthAddress });
  check('stealth address received the payment', stealthBalance === PAYMENT,
    `${formatEther(stealthBalance)} ETH`);
  const codeBefore = await publicClient.getCode({ address: stealthAddress });
  check('stealth address is a bare EOA (no code) before the sweep',
    !codeBefore || codeBefore === '0x');

  // ── 3. Recipient detects it ─────────────────────────────────
  console.log('\n3. Recipient detects the payment');
  const announcement: AnnouncementEvent = {
    schemeId: 1n,
    stealthAddress,
    ephemeralPubKey: derived.ephemeralPublicKey,
    metadata: encodeAnnouncerMetadata(derived.viewTag),
    blockNumber: await publicClient.getBlockNumber(),
    transactionHash: fundHash,
    caller: senderWallet.account.address,
  };
  const detected = detectPayment(announcement, recipient);
  check('payment detected with the viewing key', detected !== null);
  if (!detected) throw new Error('detection failed; cannot continue');

  const stealthSigner = privateKeyToAccount(detected.stealthPrivateKey);
  check('recomputed stealth key controls the stealth address',
    stealthSigner.address.toLowerCase() === stealthAddress.toLowerCase());

  // ── 4. The address reconciliation ───────────────────────────
  console.log('\n4. EIP-7702 account address == ERC-5564 stealth address');
  const account = await to7702SimpleSmartAccount({ client: publicClient, owner: stealthSigner });
  check('UserOperation sender IS the stealth address',
    account.address.toLowerCase() === stealthAddress.toLowerCase(),
    `${account.address} vs ${stealthAddress}`);
  check('EntryPoint version is 0.8', account.entryPoint.version === '0.8');
  try {
    assertAccountIsStealthAddress(account.address, stealthAddress);
    check('reconciliation gate accepts the matching pair', true);
  } catch {
    check('reconciliation gate accepts the matching pair', false);
  }
  expectRevertSync('reconciliation gate rejects a mismatched pair', () =>
    assertAccountIsStealthAddress(
      '0x000000000000000000000000000000000000dEaD',
      stealthAddress,
    ),
  );

  // ── 5. UserOperation construction ───────────────────────────
  console.log('\n5. UserOperation construction (self-funded gas)');
  const DESTINATION = '0x00000000000000000000000000000000cafe0001' as Address;
  const destBefore = await publicClient.getBalance({ address: DESTINATION });

  const block = await publicClient.getBlock();
  const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
  const maxPriorityFeePerGas = 1_000_000_000n;
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

  const verificationGasLimit = 200_000n;
  const callGasLimit = 100_000n;
  const preVerificationGas = 60_000n;

  // Self-funded gas: the account prefunds the EntryPoint out of the ETH it just
  // received. No external funding, no Paymaster, no known wallet involved.
  const requiredPrefund =
    (verificationGasLimit + callGasLimit + preVerificationGas) * maxFeePerGas;
  const gasReserve = requiredPrefund * 2n;
  const sweepAmount = stealthBalance - gasReserve;
  check('received ETH covers its own gas prefund', sweepAmount > 0n,
    `prefund ${formatEther(requiredPrefund)} ETH`);

  const nonce = await publicClient.readContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: 'getNonce',
    args: [stealthAddress, 0n],
  });

  const callData = await account.encodeCalls([
    { to: DESTINATION, value: sweepAmount, data: '0x' },
  ]);
  check('callData encodes the sweep', callData.length > 2);

  const userOperation = {
    sender: stealthAddress,
    nonce,
    callData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: '0x' as `0x${string}`,
  } as unknown as UserOperation<'0.8'>;

  const userOpHash = getUserOperationHash({
    chainId: sepolia.id,
    entryPointAddress: entryPoint08Address,
    entryPointVersion: '0.8',
    userOperation,
  });
  check('UserOperation hash computed', /^0x[0-9a-f]{64}$/i.test(userOpHash));

  // ── 6. Signature validation ─────────────────────────────────
  console.log('\n6. Signature validation');
  const signature = await account.signUserOperation(userOperation);
  check('stealth key signed the UserOperation', signature.length > 2);
  userOperation.signature = signature;

  // The 7702 authorization: the stealth EOA delegates its code. Free to sign.
  const authorization = await stealthSigner.signAuthorization({
    contractAddress: EIP7702_IMPLEMENTATION,
    chainId: sepolia.id,
    nonce: await publicClient.getTransactionCount({ address: stealthAddress }),
  });
  check('stealth key signed the EIP-7702 authorization',
    authorization.r !== undefined && authorization.s !== undefined);
  check('authorization points at the expected implementation',
    authorization.address.toLowerCase() === EIP7702_IMPLEMENTATION.toLowerCase());

  // ── 7. Execution ────────────────────────────────────────────
  console.log('\n7. Sweep execution via EntryPoint.handleOps');
  const packed = toPackedUserOperation(userOperation);

  const handleOpsData = encodeFunctionData({
    abi: entryPoint08Abi,
    functionName: 'handleOps',
    args: [[packed], bundlerAccount.address],
  });

  const execHash = await bundlerWallet.sendTransaction({
    to: entryPoint08Address,
    data: handleOpsData,
    authorizationList: [authorization],
    gas: 2_000_000n,
  });
  const execReceipt = await publicClient.waitForTransactionReceipt({ hash: execHash });
  check('handleOps transaction succeeded', execReceipt.status === 'success');

  // ── 8. Outcome ──────────────────────────────────────────────
  console.log('\n8. Outcome');
  const destAfter = await publicClient.getBalance({ address: DESTINATION });
  check('destination received the swept funds', destAfter - destBefore === sweepAmount,
    `received ${formatEther(destAfter - destBefore)} ETH, expected ${formatEther(sweepAmount)}`);

  const codeAfter = await publicClient.getCode({ address: stealthAddress });
  check('stealth address now carries a 7702 delegation',
    !!codeAfter && codeAfter.startsWith('0xef0100'), codeAfter ?? 'no code');
  check('delegation points at the expected implementation',
    !!codeAfter &&
      codeAfter.toLowerCase().includes(EIP7702_IMPLEMENTATION.slice(2).toLowerCase()));

  const stealthAfter = await publicClient.getBalance({ address: stealthAddress });
  console.log(`     residual at stealth address: ${formatEther(stealthAfter)} ETH ` +
    '(unused prefund is refunded to the EntryPoint deposit, not the balance)');

  // ── 9. Negative: wrong signer ───────────────────────────────
  console.log('\n9. Negative cases');
  const impostorKey = ('0x' + '77'.repeat(32)) as `0x${string}`;
  const impostor = privateKeyToAccount(impostorKey);
  const impostorAccount = await to7702SimpleSmartAccount({
    client: publicClient,
    owner: impostor,
  });
  check('an unrelated key produces a DIFFERENT account address',
    impostorAccount.address.toLowerCase() !== stealthAddress.toLowerCase());

  // A UserOp for the stealth address signed by someone else must fail validation.
  const forgedNonce = await publicClient.readContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: 'getNonce',
    args: [stealthAddress, 0n],
  });
  const forgedOp = {
    ...userOperation,
    nonce: forgedNonce,
    callData: await account.encodeCalls([
      { to: DESTINATION, value: 1n, data: '0x' },
    ]),
    signature: '0x' as `0x${string}`,
  } as UserOperation<'0.8'>;
  forgedOp.signature = await impostorAccount.signUserOperation(forgedOp);

  await expectRevert('UserOperation signed by the wrong key is rejected', async () => {
    await publicClient.simulateContract({
      address: entryPoint08Address,
      abi: entryPoint08Abi,
      functionName: 'handleOps',
      args: [[toPackedUserOperation(forgedOp)], bundlerAccount.address],
      account: bundlerAccount,
    });
  });

  // A stealth key from a different announcement must not control this address.
  const otherDerived = deriveStealthAddress(recipient.metaAddress);
  const otherAnnouncement: AnnouncementEvent = {
    ...announcement,
    stealthAddress: otherDerived.stealthAddress,
    ephemeralPubKey: otherDerived.ephemeralPublicKey,
    metadata: encodeAnnouncerMetadata(otherDerived.viewTag),
  };
  const otherDetected = detectPayment(otherAnnouncement, recipient);
  check('a different payment yields a different stealth key',
    otherDetected !== null &&
      otherDetected.stealthPrivateKey !== detected.stealthPrivateKey);
  check('that key does NOT control the first stealth address',
    otherDetected !== null &&
      privateKeyToAccount(otherDetected.stealthPrivateKey).address.toLowerCase() !==
        stealthAddress.toLowerCase());

  // ── 10. No known-wallet funding ─────────────────────────────
  console.log('\n10. Funding-link assertions');
  // The only value that ever entered the stealth address is the payment itself.
  check('stealth address was funded exactly once, by the payment',
    stealthBalance === PAYMENT);
  check('no gas top-up transaction was required',
    // The sweep consumed only the received ETH; nothing was sent to the
    // stealth address between the payment and the sweep.
    stealthAfter < PAYMENT && destAfter - destBefore === sweepAmount);

  console.log(`\n=== ${passed} passed, ${failures.length} failed ===`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAILED: ${f}`);
    process.exit(1);
  }
  console.log('=== LOCAL END-TO-END SWEEP VERIFIED ===');
}

function expectRevertSync(name: string, fn: () => unknown): void {
  try {
    fn();
    check(name, false, 'expected a throw');
  } catch {
    check(name, true);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
