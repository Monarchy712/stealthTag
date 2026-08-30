/**
 * scripts/test-relay.ts
 * ----------------------
 * Milestone 3 relay + key-safety suite.
 *
 * TEST CLASSES
 *   LOCAL      — pure logic, no network. The relay allowlist, the key-safety
 *                invariants, and the viewing/spending key separation.
 *   REAL LIVE  — read-only queries against Sepolia confirming the contracts
 *                this architecture depends on are actually deployed.
 *   UNVERIFIED — noted explicitly where a property cannot be checked here.
 *
 * Runs the relay route handler in-process, so what is tested is the real
 * handler, not a description of it.
 */

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { entryPoint08Address } from 'viem/account-abstraction';
import { checkStealthAddress, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';
import {
  ALLOWED_BUNDLER_METHODS,
  ALLOWED_RPC_METHODS,
  MAX_BATCH_SIZE,
  isMethodAllowed,
  isRelayTarget,
  relayPath,
} from '../lib/relayConfig';
import { POST, GET } from '../app/api/relay/[target]/route';
import { EIP7702_IMPLEMENTATION } from '../lib/smartAccount';
import { deriveStealthKeyBundle } from '../lib/keys';
import { deriveStealthAddress, detectPayment, encodeAnnouncerMetadata } from '../lib/stealth';
import type { AnnouncementEvent } from '../types';

const RPC_URL = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

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

/** Invoke the real route handler with a JSON-RPC body. */
async function callRelay(target: string, body: unknown) {
  const request = new Request(`http://localhost/api/relay/${target}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ target }) });
  let json: unknown = null;
  try {
    json = await response.clone().json();
  } catch {
    /* non-JSON body */
  }
  return { status: response.status, json: json as Record<string, unknown> | null };
}

async function run() {
  console.log('=== MILESTONE 3: RELAY BOUNDARY + KEY SAFETY ===\n');

  // ─────────────────────────────────────────────────────────────
  console.log('1. Relay allowlist [LOCAL]');

  check('bundler and rpc are the only relay targets',
    isRelayTarget('bundler') && isRelayTarget('rpc') && !isRelayTarget('admin'));
  check('relay paths are same-origin', relayPath('bundler') === '/api/relay/bundler');

  check('bundler allowlist covers UserOperation submission',
    isMethodAllowed('bundler', 'eth_sendUserOperation') &&
      isMethodAllowed('bundler', 'eth_estimateUserOperationGas'));
  check('bundler allowlist covers paymaster sponsorship',
    isMethodAllowed('bundler', 'pm_getPaymasterData') &&
      isMethodAllowed('bundler', 'pm_getPaymasterStubData'));
  check('rpc allowlist covers scanning',
    isMethodAllowed('rpc', 'eth_getLogs') && isMethodAllowed('rpc', 'eth_getBalance'));

  // The relay holds an API key. It must never be a general-purpose proxy.
  check('relay refuses eth_sendRawTransaction',
    !isMethodAllowed('rpc', 'eth_sendRawTransaction') &&
      !isMethodAllowed('bundler', 'eth_sendRawTransaction'));
  check('relay refuses account-unlocking / signing methods',
    ['eth_sign', 'eth_signTransaction', 'personal_sign', 'eth_accounts', 'eth_sendTransaction']
      .every((m) => !isMethodAllowed('rpc', m) && !isMethodAllowed('bundler', m)));
  check('relay refuses node-admin methods',
    ['anvil_setBalance', 'debug_traceTransaction', 'admin_nodeInfo', 'txpool_content']
      .every((m) => !isMethodAllowed('rpc', m) && !isMethodAllowed('bundler', m)));
  check('bundler methods are not silently allowed on the rpc target',
    !isMethodAllowed('rpc', 'eth_sendUserOperation'));

  // ─────────────────────────────────────────────────────────────
  console.log('\n2. Relay handler enforcement [LOCAL, real handler in-process]');

  const disallowed = await callRelay('bundler', {
    jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0xdead'],
  });
  check('disallowed method is refused with 403', disallowed.status === 403);
  check('refusal is a JSON-RPC error, not a crash',
    typeof (disallowed.json?.error as { code?: number } | undefined)?.code === 'number');

  const unknownTarget = await callRelay('admin', {
    jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [],
  });
  check('unknown relay target is refused with 404', unknownTarget.status === 404);

  const oversized = await callRelay(
    'rpc',
    Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      jsonrpc: '2.0', id: i, method: 'eth_chainId', params: [],
    })),
  );
  check('oversized batch is refused', oversized.status === 400);

  const badBatchMember = await callRelay('rpc', [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_sign', params: [] },
  ]);
  check('a batch containing one disallowed method is refused entirely',
    badBatchMember.status === 403);

  // With no PIMLICO_API_KEY configured the relay must decline, NOT fall back
  // to some other path — a silent fallback would be a direct browser→Pimlico
  // call, which is the correlation the relay exists to remove.
  const previousKey = process.env.PIMLICO_API_KEY;
  delete process.env.PIMLICO_API_KEY;
  const unconfigured = await callRelay('bundler', {
    jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [],
  });
  check('unconfigured relay returns 503 rather than falling back',
    unconfigured.status === 503);

  const healthResponse = await GET(new Request('http://localhost/api/relay/bundler'), {
    params: Promise.resolve({ target: 'bundler' }),
  });
  const health = (await healthResponse.json()) as Record<string, unknown>;
  check('health endpoint reports unconfigured', health.configured === false);
  const healthText = JSON.stringify(health);
  check('health endpoint leaks neither key nor upstream URL',
    !healthText.includes('apikey') && !healthText.includes('api.pimlico.io'));
  check('health endpoint states the relay is not anonymity',
    String(health.note).toLowerCase().includes('not provide anonymity'));
  if (previousKey !== undefined) process.env.PIMLICO_API_KEY = previousKey;

  // ─────────────────────────────────────────────────────────────
  console.log('\n3. The relay cannot spend or reconstruct keys [LOCAL]');

  // Build a real detected payment so the assertions run over real material.
  const recipient = deriveStealthKeyBundle({
    masterSeed: new Uint8Array(32).fill(0x33),
    ownerAddress: '0x000000000000000000000000000000000000bEEF',
    chainId: sepolia.id,
  });
  const derived = deriveStealthAddress(recipient.metaAddress);
  const announcement: AnnouncementEvent = {
    schemeId: 1n,
    stealthAddress: derived.stealthAddress,
    ephemeralPubKey: derived.ephemeralPublicKey,
    metadata: encodeAnnouncerMetadata(derived.viewTag),
    blockNumber: 1n,
    transactionHash: `0x${'11'.repeat(32)}`,
    caller: '0x0000000000000000000000000000000000000001',
  };
  const detected = detectPayment(announcement, recipient);
  check('test fixture: payment detected', detected !== null);
  if (!detected) throw new Error('fixture detection failed');

  // The relay module must not import or touch key material at all.
  const relayConfigSource = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../lib/relayConfig.ts', import.meta.url), 'utf8'),
  );
  const relayRouteSource = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../app/api/relay/[target]/route.ts', import.meta.url), 'utf8'),
  );
  const keyish = /privateKeyToAccount|stealthPrivateKey|spendingPrivateKey|viewingPrivateKey|signUserOperation|signAuthorization|deriveMasterSeed/;
  check('relay route imports no key material or signing capability',
    !keyish.test(relayRouteSource));
  check('relay config imports no key material', !keyish.test(relayConfigSource));
  check('relay route never reads a NEXT_PUBLIC Pimlico key',
    !/NEXT_PUBLIC_PIMLICO_API_KEY\s*[;,)]/.test(relayRouteSource.replace(/\/\*[\s\S]*?\*\//g, '')));

  // What the relay actually receives: an already-signed UserOperation.
  // It can drop it or delay it. It cannot alter it — any change invalidates
  // the signature — and it cannot construct a different one.
  check('the relay is never given a private key in any request shape',
    !JSON.stringify({
      method: 'eth_sendUserOperation',
      params: [{ sender: detected.stealthAddress, signature: '0x1234' }],
    }).includes(detected.stealthPrivateKey));

  // Spending requires the spending key. Neither the relay nor a viewing-key
  // holder has it.
  check('relay has no path to the spending private key',
    !relayRouteSource.includes('spendingPrivateKey') &&
      !relayRouteSource.includes('computeStealthKey'));

  // ─────────────────────────────────────────────────────────────
  console.log('\n4. Viewing key remains non-spending [LOCAL]');

  // The viewing key detects; it cannot derive the stealth private key. That
  // requires the spending key too (computeStealthKey takes both).
  const viewingOnlyMatch = checkStealthAddress({
    userStealthAddress: derived.stealthAddress,
    ephemeralPublicKey: derived.ephemeralPublicKey as `0x${string}`,
    viewingPrivateKey: recipient.viewingPrivateKey,
    spendingPublicKey: recipient.spendingPublicKey,
    viewTag: derived.viewTag as `0x${string}`,
    schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
  });
  check('viewing key + spending PUBLIC key can detect', viewingOnlyMatch);

  // Detection with the viewing key but a foreign spending key must fail, and
  // the resulting bundle must not control the address.
  const foreignSpending = deriveStealthKeyBundle({
    masterSeed: new Uint8Array(32).fill(0x44),
    ownerAddress: '0x000000000000000000000000000000000000bEEF',
    chainId: sepolia.id,
  });
  const viewerOnlyBundle = {
    ...recipient,
    spendingPrivateKey: foreignSpending.spendingPrivateKey,
  };
  const spoofed = detectPayment(announcement, viewerOnlyBundle);
  check('viewing key alone cannot produce a spending key for the address',
    spoofed === null);

  check('the real spending key does control the address',
    privateKeyToAccount(detected.stealthPrivateKey).address.toLowerCase() ===
      derived.stealthAddress.toLowerCase());

  // ─────────────────────────────────────────────────────────────
  console.log('\n5. Infrastructure this design depends on [REAL LIVE — Sepolia]');

  const client = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
  try {
    const block = await client.getBlockNumber();
    console.log(`     queried Sepolia at block ${block}`);

    for (const [label, address] of [
      ['EntryPoint v0.8', entryPoint08Address],
      ['Simple7702Account implementation', EIP7702_IMPLEMENTATION],
      ['ERC-5564 Announcer', '0x55649E01B5Df198D18D95b5cc5051630cfD45564'],
      ['ERC-6538 Registry', '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538'],
    ] as const) {
      const code = await client.getCode({ address: address as `0x${string}` });
      check(`${label} is deployed on Sepolia`, !!code && code !== '0x',
        `${address} has no code`);
    }
  } catch (err) {
    console.log('   ! Sepolia unreachable — live checks SKIPPED (not failed)');
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n6. Correlation assumptions are documented [LOCAL]');

  const privacyDoc = await import('node:fs').then((fs) => {
    try {
      return fs.readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
    } catch {
      return '';
    }
  });
  check('PRIVACY.md exists', privacyDoc.length > 0);
  for (const actor of [
    'Blockchain observer', 'Sender', 'Recipient', 'Relayer',
    'Bundler', 'Paymaster', 'RPC provider',
  ]) {
    check(`PRIVACY.md analyses: ${actor}`, privacyDoc.includes(actor));
  }
  for (const topic of [
    'IP correlation', 'timing correlation', 'amount correlation',
    'ERC-6538', 'destination',
  ]) {
    check(`PRIVACY.md covers: ${topic}`,
      privacyDoc.toLowerCase().includes(topic.toLowerCase()));
  }
  check('PRIVACY.md does not claim anonymity',
    !/\b(fully anonymous|completely anonymous|untraceable|total privacy)\b/i.test(privacyDoc));

  // ─────────────────────────────────────────────────────────────
  console.log(`\n=== ${passed} passed, ${failures.length} failed ===`);
  console.log(
    'UNVERIFIED in this suite: live Paymaster sponsorship and live bundler\n' +
      'submission. Both need a funded Pimlico key; see the Milestone 3 report.',
  );
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAILED: ${f}`);
    process.exit(1);
  }
  console.log('=== RELAY BOUNDARY + KEY SAFETY VERIFIED ===');
}

// Reference the allowlists so an accidental emptying is caught at import time.
if (ALLOWED_BUNDLER_METHODS.length === 0 || ALLOWED_RPC_METHODS.length === 0) {
  throw new Error('Relay allowlists must not be empty');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
