/**
 * scripts/verify-live-sponsored.ts
 * ---------------------------------
 * REAL LIVE verification of the sponsored ERC-4337 path on Sepolia.
 *
 *   stealth EOA → EIP-7702 auth → UserOperation → relay → Pimlico bundler
 *               → EntryPoint v0.8 → Pimlico Paymaster → destination
 *
 * This is the one link in the Milestone 3 chain that the local anvil suite
 * cannot cover, because a Paymaster that is mocked proves nothing.
 *
 * DESIGN CONSTRAINTS HONOURED
 *   - Calls the production `sponsoredSweep(...)` from lib/smartAccount.ts.
 *     No parallel implementation, no architectural change.
 *   - The relay stays in the path. The recipient side never calls Pimlico
 *     directly; if the relay is down the run aborts rather than falling back.
 *   - The Paymaster is real. Sponsorship is asserted from the on-chain
 *     UserOperationEvent, not assumed.
 *   - ERC-5564 derivation/detection is used unchanged.
 *   - The self-funded path is untouched; this exercises gasMode 'sponsored'.
 *   - Sepolia only. The script refuses to run on any other chain id.
 *
 * SECRETS
 *   Reads SENDER_PRIVATE_KEY from the environment. It is never logged, never
 *   written to a file, and never sent to the relay. PIMLICO_API_KEY is read
 *   only by the relay process, never by this script.
 *
 * TWO MODES
 *   --preflight  Spends NOTHING. Checks every prerequisite, including a live
 *                paymaster sponsorship quote, then stops.
 *   --execute    Spends real Sepolia ETH from SENDER_PRIVATE_KEY.
 */

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address } from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { to7702SimpleSmartAccount } from 'permissionless/accounts';
import { deriveStealthKeyBundle } from '../lib/keys';
import { deriveStealthAddress, detectPayment, encodeAnnouncerMetadata } from '../lib/stealth';
import { publishAnnouncement, fetchAnnouncements } from '../lib/announcer';
import { scanAnnouncements } from '../lib/stealth';
import { sponsoredSweep, EIP7702_IMPLEMENTATION } from '../lib/smartAccount';
import { relayRpcTransport, relayBundlerTransport, relayUrl, isRelayConfigured } from '../lib/relay';
import { CONTRACT_ADDRESSES } from '../lib/chain';
import type { AnnouncementEvent } from '../types';

// ===========================================================
// Configuration (all from env; no credentials are invented)
// ===========================================================

const MODE = process.argv.includes('--execute') ? 'execute' : 'preflight';

/** Resume mode: skip the payment + announcement and sweep a stealth address
 *  that was already funded and announced by an earlier run. Spends NOTHING
 *  from the sender — the Paymaster covers the gas — and still exercises the
 *  full sponsored path end to end. Used to verify the path without burning
 *  more test ETH, and to recover funds stranded by a failed attempt. */
const RESUME = process.argv.includes('--resume');

/** Sender's funded Sepolia key. NEVER printed. */
const SENDER_PRIVATE_KEY = process.env.SENDER_PRIVATE_KEY as `0x${string}` | undefined;

/** Direct RPC for the SENDER only — a real sender uses their own wallet's RPC.
 *  The recipient side goes exclusively through the relay. */
const SENDER_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

/** How much the sender pays the stealth address. Kept small on purpose. */
const PAYMENT_AMOUNT = parseEther(process.env.LIVE_TEST_AMOUNT ?? '0.002');

/** Where the sweep lands. Must NOT be the recipient's known wallet. */
const DESTINATION = (process.env.LIVE_TEST_DESTINATION ??
  '0x00000000000000000000000000000000cafe0001') as Address;

/** Stands in for "the recipient's known wallet" — the address whose linkage we
 *  are proving does not exist. The script asserts it is never used. */
const RECIPIENT_KNOWN_WALLET = (process.env.LIVE_TEST_KNOWN_WALLET ??
  '0x000000000000000000000000000000000000bEEF') as Address;

// ===========================================================
// Reporting
// ===========================================================

let passed = 0;
const failures: string[] = [];
const artifacts: Record<string, string> = {};

function check(name: string, condition: boolean, detail = ''): boolean {
  if (condition) {
    passed++;
    console.log(`   ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`   ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return condition;
}

function record(key: string, value: string): void {
  artifacts[key] = value;
  console.log(`     ${key.padEnd(26)} ${value}`);
}

function abort(reason: string, remedy: string): never {
  console.error(`\n╔═ BLOCKED ═════════════════════════════════════════════`);
  console.error(`║ ${reason}`);
  console.error(`║`);
  console.error(`║ To proceed: ${remedy}`);
  console.error(`╚═══════════════════════════════════════════════════════\n`);
  process.exit(2);
}

// ===========================================================
// Run
// ===========================================================

async function run() {
  console.log(`=== MILESTONE 3: LIVE SPONSORED PATH (${MODE.toUpperCase()}) ===\n`);
  if (MODE === 'preflight') {
    console.log('Preflight only. Nothing will be sent and no funds will move.\n');
  } else {
    console.log('EXECUTE MODE. This WILL spend real Sepolia ETH.\n');
  }

  // ── Prerequisite 1: relay reachable and configured ──────────
  console.log('1. Relay [must stay in the path]');
  record('relay bundler endpoint', relayUrl('bundler'));
  record('relay rpc endpoint', relayUrl('rpc'));

  const bundlerReady = await isRelayConfigured('bundler');
  if (!check('relay bundler target is configured', bundlerReady)) {
    abort(
      'The relay has no PIMLICO_API_KEY, so no Paymaster can be reached.',
      'start the app with PIMLICO_API_KEY set (see .env.example) and re-run. ' +
        'Do NOT work around this by calling Pimlico from the client.',
    );
  }
  const rpcReady = await isRelayConfigured('rpc');
  if (!check('relay rpc target is configured', rpcReady)) {
    abort('The relay has no RELAY_RPC_URL.', 'set RELAY_RPC_URL and restart the app.');
  }

  // Every recipient-side read goes through the relay.
  const relayClient = createPublicClient({ chain: sepolia, transport: relayRpcTransport() });
  const chainId = await relayClient.getChainId();
  if (!check('relay is on Sepolia (11155111)', chainId === sepolia.id, `got ${chainId}`)) {
    abort(`Relay upstream is chain ${chainId}, not Sepolia.`, 'point RELAY_RPC_URL at Sepolia.');
  }

  // ── Prerequisite 2: infrastructure ──────────────────────────
  console.log('\n2. On-chain infrastructure');
  for (const [label, address] of [
    ['EntryPoint v0.8', entryPoint08Address],
    ['Simple7702Account impl', EIP7702_IMPLEMENTATION],
    ['ERC-5564 Announcer', CONTRACT_ADDRESSES.ANNOUNCER],
  ] as const) {
    const code = await relayClient.getCode({ address: address as `0x${string}` });
    check(`${label} deployed`, !!code && code !== '0x');
  }

  // ── Prerequisite 3: sender key ──────────────────────────────
  // A funded key is needed only to SPEND, i.e. only for --execute. Preflight
  // must be able to validate Paymaster sponsorship without one, so that the
  // decisive check is reachable before any key is put at risk.
  console.log('\n3. Funded sender');
  const senderClient = createPublicClient({ chain: sepolia, transport: http(SENDER_RPC_URL) });
  let senderAccount: ReturnType<typeof privateKeyToAccount> | null = null;

  if (!SENDER_PRIVATE_KEY) {
    if (MODE === 'execute' && !RESUME) {
      abort(
        'SENDER_PRIVATE_KEY is not set, so nothing can pay the stealth address.',
        'export SENDER_PRIVATE_KEY=0x… for a THROWAWAY Sepolia key holding a little test ETH. ' +
          'It is never logged and never committed.',
      );
    }
    console.log('   – SENDER_PRIVATE_KEY not set: skipped (only required for --execute)');
  } else {
    senderAccount = privateKeyToAccount(SENDER_PRIVATE_KEY);
    record('sender address', senderAccount.address);

    const senderBalance = await senderClient.getBalance({ address: senderAccount.address });
    record('sender balance', `${formatEther(senderBalance)} ETH`);

    // Payment + announcement + headroom.
    const REQUIRED = PAYMENT_AMOUNT + parseEther('0.004');
    const funded = check('sender balance covers payment + announcement',
      senderBalance >= REQUIRED, `need ~${formatEther(REQUIRED)} ETH`);
    if (!funded && MODE === 'execute') {
      abort(
        `Sender holds ${formatEther(senderBalance)} ETH, needs ~${formatEther(REQUIRED)} ETH.`,
        `fund ${senderAccount.address} from a Sepolia faucet.`,
      );
    }

    check('destination is NOT the sender',
      DESTINATION.toLowerCase() !== senderAccount.address.toLowerCase());
  }

  check('destination is NOT the recipient\'s known wallet',
    DESTINATION.toLowerCase() !== RECIPIENT_KNOWN_WALLET.toLowerCase());

  // ── Prerequisite 4: recipient identity ──────────────────────
  console.log('\n4. Recipient identity (unchanged ERC-5564 + Milestone 2 KDF)');
  const seedHex = process.env.LIVE_TEST_SEED ?? '5'.repeat(64);
  const masterSeed = Uint8Array.from(Buffer.from(seedHex, 'hex'));
  if (masterSeed.length !== 32) {
    abort('LIVE_TEST_SEED must be 64 hex characters.', 'unset it to use the default test seed.');
  }
  const recipient = deriveStealthKeyBundle({
    masterSeed,
    ownerAddress: RECIPIENT_KNOWN_WALLET,
    chainId: sepolia.id,
  });
  record('recipient meta-address', `${recipient.metaAddress.slice(0, 30)}…`);
  record('recipient known wallet', RECIPIENT_KNOWN_WALLET);

  const derived = deriveStealthAddress(recipient.metaAddress);
  const stealthAddress = derived.stealthAddress;
  record('stealth address', stealthAddress);
  record('destination', DESTINATION);

  // Baselines for the no-linkage assertions.
  const knownWalletNonceBefore = await relayClient.getTransactionCount({
    address: RECIPIENT_KNOWN_WALLET,
  });
  const knownWalletBalanceBefore = await relayClient.getBalance({
    address: RECIPIENT_KNOWN_WALLET,
  });
  const stealthBefore = await relayClient.getBalance({ address: stealthAddress });
  const destBefore = await relayClient.getBalance({ address: DESTINATION });
  check('stealth address is fresh (zero balance)', stealthBefore === 0n,
    `${formatEther(stealthBefore)} ETH already present`);
  const stealthCodeBefore = await relayClient.getCode({ address: stealthAddress });
  check('stealth address has no code yet', !stealthCodeBefore || stealthCodeBefore === '0x');

  // ── Prerequisite 5: LIVE paymaster quote (no spend) ─────────
  console.log('\n5. Paymaster reachability [live quote via the relay, spends nothing]');
  const pimlicoClient = createPimlicoClient({
    transport: relayBundlerTransport(),
    entryPoint: { address: entryPoint08Address, version: '0.8' },
  });

  try {
    const gasPrice = await pimlicoClient.getUserOperationGasPrice();
    check('bundler answered getUserOperationGasPrice via the relay',
      gasPrice.fast.maxFeePerGas > 0n);
    record('maxFeePerGas (fast)', `${gasPrice.fast.maxFeePerGas} wei`);
  } catch (err) {
    abort(
      `The relay could not reach the Pimlico bundler: ${err instanceof Error ? err.message : String(err)}`,
      'check PIMLICO_API_KEY validity and that the key has Sepolia enabled.',
    );
  }

  // Ask the real Paymaster for stub data for this exact account. This is the
  // decisive preflight: if sponsorship is not available, it fails here rather
  // than after money has moved.
  try {
    const probeAccount = await to7702SimpleSmartAccount({
      client: relayClient,
      owner: privateKeyToAccount(`0x${'ab'.repeat(32)}`),
    });
    const stub = await pimlicoClient.getPaymasterStubData({
      chainId: sepolia.id,
      entryPointAddress: entryPoint08Address,
      sender: probeAccount.address,
      nonce: 0n,
      callData: '0x',
      callGasLimit: 100_000n,
      verificationGasLimit: 200_000n,
      preVerificationGas: 60_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
    check('Paymaster returned sponsorship stub data',
      !!stub && Object.keys(stub).length > 0);
    if (stub && 'paymaster' in stub && stub.paymaster) {
      record('paymaster address', String(stub.paymaster));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    abort(
      `The Paymaster declined to quote sponsorship: ${message}`,
      'confirm the Pimlico account has a Sepolia sponsorship policy enabled and ' +
        'a non-zero gas balance. Sponsorship cannot be mocked — this must be real.',
    );
  }

  if (MODE === 'preflight') {
    console.log(`\n=== PREFLIGHT: ${passed} passed, ${failures.length} failed ===`);
    if (failures.length > 0) {
      for (const f of failures) console.error(`FAILED: ${f}`);
      process.exit(1);
    }
    console.log(
      '\nAll prerequisites satisfied. NOTHING WAS SPENT.\n' +
        'To run the live sponsored sweep:\n' +
        '  npm run verify:live -- --execute\n',
    );
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // EXECUTE — from here on, real funds move.
  // ═══════════════════════════════════════════════════════════

  // ── Resume path: sweep an already-funded, already-announced address ──
  if (RESUME) {
    console.log('\n6-8. RESUME: locating an existing funded stealth payment');
    console.log('     (no payment or announcement is sent; the sender spends nothing)');

    const latest = await relayClient.getBlockNumber();
    const fromBlock = latest > 500n ? latest - 500n : 0n;
    const announcements = await fetchAnnouncements(fromBlock, 'latest', relayClient);
    console.log(`     scanned ${announcements.length} announcements from block ${fromBlock}`);

    const mine = scanAnnouncements(announcements, recipient);
    check('detected at least one payment for this identity', mine.length > 0);

    let target: (typeof mine)[number] | null = null;
    for (const p of mine) {
      const bal = await relayClient.getBalance({ address: p.stealthAddress });
      if (bal > 0n) {
        target = { ...p, balance: bal };
        break;
      }
    }
    if (!target) {
      abort(
        'No detected stealth address with a non-zero balance in the scanned range.',
        'run without --resume to make a fresh payment, or widen the scan range.',
      );
    }

    record('resumed stealth address', target.stealthAddress);
    record('resumed balance', `${formatEther(target.balance ?? 0n)} ETH`);
    check('recomputed stealth key controls the stealth address',
      privateKeyToAccount(target.stealthPrivateKey).address.toLowerCase() ===
        target.stealthAddress.toLowerCase());

    await sweepAndVerify(target, target.balance ?? 0n, relayClient, destBefore, {
      knownWalletNonceBefore,
      knownWalletBalanceBefore,
    });
    return;
  }

  if (!senderAccount) {
    abort('No sender account available for --execute.', 'set SENDER_PRIVATE_KEY.');
  }
  const senderWallet = createWalletClient({
    account: senderAccount,
    chain: sepolia,
    transport: http(SENDER_RPC_URL),
  });

  // ── Step A: sender pays the stealth address ─────────────────
  console.log('\n6. Sender pays the stealth address [the ONLY inbound transfer]');
  const paymentHash = await senderWallet.sendTransaction({
    to: stealthAddress,
    value: PAYMENT_AMOUNT,
  });
  record('payment tx', paymentHash);
  await senderClient.waitForTransactionReceipt({ hash: paymentHash });

  const stealthFunded = await relayClient.getBalance({ address: stealthAddress });
  check('stealth address received the payment', stealthFunded === PAYMENT_AMOUNT,
    `${formatEther(stealthFunded)} ETH`);

  // ── Step B: sender announces ────────────────────────────────
  console.log('\n7. Sender publishes the ERC-5564 announcement');
  const announceHash = await publishAnnouncement(
    senderWallet,
    stealthAddress,
    derived.ephemeralPublicKey,
    derived.viewTag,
  );
  record('announcement tx', announceHash);
  const announceReceipt = await senderClient.waitForTransactionReceipt({ hash: announceHash });
  check('announcement confirmed', announceReceipt.status === 'success');

  // ── Step C: recipient detects, through the relay ────────────
  console.log('\n8. Recipient detects the payment (viewing key)');
  const announcement: AnnouncementEvent = {
    schemeId: 1n,
    stealthAddress,
    ephemeralPubKey: derived.ephemeralPublicKey,
    metadata: encodeAnnouncerMetadata(derived.viewTag),
    blockNumber: announceReceipt.blockNumber,
    transactionHash: announceHash,
    caller: senderAccount.address,
  };
  const detected = detectPayment(announcement, recipient);
  if (!check('payment detected with the viewing key', detected !== null)) {
    abort('Detection failed; cannot continue.', 'investigate before re-running.');
  }
  if (!detected) return;
  detected.balance = stealthFunded;
  check('recomputed stealth key controls the stealth address',
    privateKeyToAccount(detected.stealthPrivateKey).address.toLowerCase() ===
      stealthAddress.toLowerCase());

  await sweepAndVerify(detected, stealthFunded, relayClient, destBefore, {
    knownWalletNonceBefore,
    knownWalletBalanceBefore,
    paymentHash,
    announceHash,
  });
}

// ===========================================================
// The sponsored sweep + its verification
// ===========================================================
// Shared by the full run and by --resume so both exercise IDENTICAL code.

interface VerifyContext {
  knownWalletNonceBefore: number;
  knownWalletBalanceBefore: bigint;
  paymentHash?: `0x${string}`;
  announceHash?: `0x${string}`;
}

async function sweepAndVerify(
  detected: NonNullable<ReturnType<typeof detectPayment>>,
  expectedAmount: bigint,
  relayClient: ReturnType<typeof createPublicClient>,
  destBefore: bigint,
  ctx: VerifyContext,
): Promise<void> {
  const stealthAddress = detected.stealthAddress;

  // ── THE SPONSORED SWEEP (production code path) ──────────────
  console.log('\n9. Sponsored sweep: 7702 auth + UserOp → relay → bundler → EntryPoint');
  const result = await sponsoredSweep(detected, DESTINATION, 'sponsored');
  record('userOpHash', result.userOpHash);
  record('bundler tx', result.transactionHash);
  record('swept amount', `${formatEther(result.value)} ETH`);
  check('gas mode was sponsored', result.gasMode === 'sponsored');
  check('UserOperation sender was the stealth address',
    result.from.toLowerCase() === stealthAddress.toLowerCase());

  // ── Prove the Paymaster actually paid ───────────────────────
  console.log('\n10. Sponsorship proof (from chain, not assumption)');
  const bundlerClient = createPimlicoClient({
    transport: relayBundlerTransport(),
    entryPoint: { address: entryPoint08Address, version: '0.8' },
  });
  const userOpReceipt = await bundlerClient.getUserOperationReceipt({
    hash: result.userOpHash,
  });
  check('UserOperation succeeded', userOpReceipt?.success === true);

  const paymaster = userOpReceipt?.paymaster;
  const sponsored =
    !!paymaster && paymaster !== '0x0000000000000000000000000000000000000000';
  check('a Paymaster is recorded on the UserOperationEvent', sponsored,
    `paymaster field: ${paymaster ?? 'absent'}`);
  if (paymaster) record('paymaster (on-chain)', paymaster);
  if (userOpReceipt?.actualGasCost !== undefined) {
    record('actualGasCost (paid by Paymaster)', `${formatEther(userOpReceipt.actualGasCost)} ETH`);
  }

  // ── Outcome ─────────────────────────────────────────────────
  console.log('\n11. Outcome');
  const destAfter = await relayClient.getBalance({ address: DESTINATION });
  const stealthAfter = await relayClient.getBalance({ address: stealthAddress });

  check('destination received the swept funds', destAfter - destBefore === result.value,
    `received ${formatEther(destAfter - destBefore)}, expected ${formatEther(result.value)}`);
  check('the FULL payment was swept (Paymaster covered gas, not the payment)',
    result.value === expectedAmount,
    `swept ${formatEther(result.value)} of ${formatEther(expectedAmount)}`);
  check('stealth address is drained', stealthAfter === 0n,
    `${formatEther(stealthAfter)} ETH left`);

  const stealthCodeAfter = await relayClient.getCode({ address: stealthAddress });
  check('stealth address carries a 7702 delegation',
    !!stealthCodeAfter && stealthCodeAfter.startsWith('0xef0100'));
  check('delegation points at the expected implementation',
    !!stealthCodeAfter &&
      stealthCodeAfter.toLowerCase().includes(EIP7702_IMPLEMENTATION.slice(2).toLowerCase()));

  // ── The no-linkage assertions ───────────────────────────────
  console.log('\n12. No known-wallet → stealth-address funding exists');
  const knownWalletNonceAfter = await relayClient.getTransactionCount({
    address: RECIPIENT_KNOWN_WALLET,
  });
  const knownWalletBalanceAfter = await relayClient.getBalance({
    address: RECIPIENT_KNOWN_WALLET,
  });
  check("recipient's known wallet sent NO transaction",
    knownWalletNonceAfter === ctx.knownWalletNonceBefore,
    `nonce ${ctx.knownWalletNonceBefore} → ${knownWalletNonceAfter}`);
  check("recipient's known wallet balance unchanged",
    knownWalletBalanceAfter === ctx.knownWalletBalanceBefore);
  check('no gas top-up transfer was needed at any point',
    // The full received amount reached the destination, so nothing at this
    // address was consumed for gas — the Paymaster paid all of it.
    result.value === expectedAmount && stealthAfter === 0n);

  // ── Artifacts ───────────────────────────────────────────────
  console.log('\n13. Identifiers for later verification');
  if (ctx.paymentHash) {
    console.log(`     https://sepolia.etherscan.io/tx/${ctx.paymentHash}   (payment)`);
  }
  if (ctx.announceHash) {
    console.log(`     https://sepolia.etherscan.io/tx/${ctx.announceHash}   (announcement)`);
  }
  console.log(`     https://sepolia.etherscan.io/tx/${result.transactionHash}   (sponsored sweep)`);
  console.log(`     https://sepolia.etherscan.io/address/${stealthAddress}   (stealth address)`);
  console.log(`     userOpHash: ${result.userOpHash}`);
  console.log(`\n     JSON:\n${JSON.stringify(artifacts, null, 2)}`);

  console.log(`\n=== LIVE: ${passed} passed, ${failures.length} failed ===`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAILED: ${f}`);
    process.exit(1);
  }
  console.log('=== SPONSORED ERC-4337 PATH VERIFIED LIVE ON SEPOLIA ===');
}

run().catch((err) => {
  // Never let a thrown error carry key material into the log.
  const message = err instanceof Error ? err.message : String(err);
  const redacted = SENDER_PRIVATE_KEY
    ? message.split(SENDER_PRIVATE_KEY).join('[REDACTED]')
    : message;
  console.error(`\nRun failed: ${redacted}`);
  process.exit(1);
});
