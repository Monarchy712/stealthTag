'use client';

/**
 * app/explore/page.tsx — Unlinkability Explorer
 *
 * This is the "find the link — you can't" demo view.
 *
 * Shows:
 *  - The recipient's public handle (meta-address)
 *  - Multiple one-time stealth addresses that received payments
 *  - A challenge: "Try to link these addresses to the handle or to each other"
 *  - Clear explanation of why the link is computationally infeasible
 */

import { useState } from 'react';
import { EyeOff, Link2, Link2Off, Search, Shield } from 'lucide-react';
import {
  AlertBox,
  Badge,
  Button,
  Card,
  Divider,
  SectionHeading,
} from '@/components/ui';
import { DEMO_META_ADDRESS, DEMO_PAYMENTS } from '@/lib/demo';
import { useStealthKeys } from '@/hooks/useStealthKeys';

export default function ExplorePage() {
  const { keyBundle } = useStealthKeys();
  const [challenged, setChallenged] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handle = keyBundle?.metaAddress ?? DEMO_META_ADDRESS;
  const payments = DEMO_PAYMENTS;

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <SectionHeading
        badge="Unlinkability Demo"
        title='Find the link — you can&apos;t'
        subtitle="This is what an on-chain observer sees when they try to trace payments to your handle."
      />

      {/* The challenge */}
      <Card className="mb-6 border-yellow-800/40 bg-yellow-950/10">
        <div className="flex items-start gap-3">
          <Search className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-white mb-1">The Observer Challenge</h3>
            <p className="text-sm text-gray-300">
              Below is a public StealthTag handle. Three payments were sent to it.
              Each payment landed at a <em>different</em> on-chain address.
              Try to connect the addresses to each other, or to the handle.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Hint: you can't — without the viewing key, the ECDH link is computationally infeasible.
            </p>
          </div>
        </div>
      </Card>

      {/* Handle */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-300">Public handle (meta-address)</h3>
          <Badge variant="info">Published</Badge>
        </div>
        <div className="bg-gray-900 border border-indigo-800/40 rounded-xl p-4">
          <p className="font-mono text-xs text-indigo-300 break-all leading-relaxed">{handle}</p>
        </div>
      </div>

      <Divider label="Payments received" />

      {/* Payment addresses — these look like random addresses */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2Off className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-gray-300">
              One-time stealth addresses (appear as random addresses on-chain)
            </h3>
          </div>
          <Badge variant="default">{payments.length} payments</Badge>
        </div>

        <div className="space-y-3">
          {payments.map((payment, idx) => (
            <Card key={payment.stealthAddress} className="bg-gray-950/60">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">Address #{idx + 1}</Badge>
                    <span className="text-xs text-gray-500">Block #{payment.blockNumber.toString()}</span>
                  </div>
                  <p className="font-mono text-sm text-violet-300 break-all">
                    {payment.stealthAddress}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-gray-500">Amount: {payment.amount} ETH</span>
                    <span className="text-xs text-gray-600">•</span>
                    <span className="text-xs text-gray-500">From: {payment.senderLabel}</span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <a
                    href={`https://sepolia.etherscan.io/address/${payment.stealthAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-800/50 rounded-lg px-2 py-1"
                  >
                    Etherscan ↗
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* The challenge button */}
      <Card className="mb-6 border-gray-700">
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Link2 className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold text-white">
              Can you link these addresses to the handle?
            </h3>
          </div>

          {!challenged ? (
            <Button
              variant="secondary"
              onClick={() => setChallenged(true)}
              className="mx-auto"
            >
              <Search className="w-4 h-4" />
              Try to link them
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-red-400">
                <Link2Off className="w-5 h-5" />
                <span className="font-bold">You can&apos;t.</span>
              </div>
              <p className="text-sm text-gray-400 max-w-lg mx-auto">
                Each stealth address was derived via ECDH using a fresh ephemeral keypair.
                Without the viewing key, reconstructing the ECDH shared secret is computationally
                infeasible — equivalent to breaking secp256k1. The addresses look like any
                random Ethereum addresses to an observer.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* What's still observable — Honesty & Audit Findings */}
      <Card className="mb-6 border-amber-800/40 bg-amber-950/20">
        <div className="flex items-start gap-3">
          <EyeOff className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="w-full">
            <h4 className="font-bold text-white text-sm mb-2 flex items-center justify-between">
              <span>What&apos;s Still Observable On-Chain</span>
              <Badge variant="warning">Privacy Audit</Badge>
            </h4>
            <div className="grid sm:grid-cols-2 gap-3 text-xs text-gray-300">
              <div className="bg-gray-950/70 p-3 rounded-lg border border-amber-900/30">
                <span className="font-semibold text-amber-300 block mb-1">1. Transfer Amounts Are Public</span>
                Amounts transferred to stealth addresses are visible on-chain. Round or matching amounts can correlate a sender transaction to a stealth deposit.
              </div>
              <div className="bg-gray-950/70 p-3 rounded-lg border border-amber-900/30">
                <span className="font-semibold text-amber-300 block mb-1">2. ERC-6538 Registry Linkage</span>
                Registering on-chain visibly ties your EOA to your meta-address. <em>Mitigation:</em> Register via a fresh EOA or distribute your meta-address off-chain.
              </div>
              <div className="bg-gray-950/70 p-3 rounded-lg border border-amber-900/30">
                <span className="font-semibold text-amber-300 block mb-1">3. Announcement Timing & Count</span>
                ERC-5564 Announcer events are public. Their total count, frequency, and block timestamps remain visible to observers.
              </div>
              <div className="bg-gray-950/70 p-3 rounded-lg border border-amber-900/30">
                <span className="font-semibold text-amber-300 block mb-1">4. Network / RPC Metadata</span>
                Without a private RPC relay, your IP address can be observed when scanning announcements or broadcasting transactions.
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Reveal (educational) */}
      <Card className="border-indigo-800/30">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-white text-sm">
            How each stealth address was derived
          </h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? 'Hide' : 'Show math'}
          </Button>
        </div>

        {!revealed ? (
          <p className="text-xs text-gray-500">
            Click &quot;Show math&quot; to see the ERC-5564 ECDH derivation behind each address.
          </p>
        ) : (
          <div className="space-y-4 text-xs text-gray-400">
            <div className="bg-gray-950 rounded-xl p-4 font-mono space-y-2">
              <p className="text-indigo-300">// For each payment:</p>
              <p>ephemeralKey = generateRandomPrivateKey()     <span className="text-gray-600">// fresh per payment</span></p>
              <p>E = ephemeralKey × G                          <span className="text-gray-600">// ephemeral pubkey</span></p>
              <p>S = ephemeralKey × K_spend                   <span className="text-gray-600">// ECDH shared secret</span></p>
              <p>h = keccak256(S)                              <span className="text-gray-600">// hash of secret</span></p>
              <p>stealthAddr = (h × G) + K_spend               <span className="text-gray-600">// one-time address</span></p>
              <p>viewTag = h[0]                                <span className="text-gray-600">// first byte, for scan speedup</span></p>
            </div>
            <div className="bg-gray-950 rounded-xl p-4 font-mono space-y-2">
              <p className="text-violet-300">// Recipient detection (with viewing key):</p>
              <p>S&apos; = viewingKey × E                          <span className="text-gray-600">// same shared secret!</span></p>
              <p>h&apos; = keccak256(S&apos;)                            <span className="text-gray-600">// same hash</span></p>
              <p>check viewTag match                           <span className="text-gray-600">// 256× speedup</span></p>
              <p>reconstruct stealthAddr from h&apos; + K_spend     <span className="text-gray-600">// confirm match</span></p>
            </div>
            <AlertBox type="info">
              The ephemeral public key E is published in the ERC-5564 Announcer.
              Only someone with the viewing key can recompute S′ and confirm ownership.
              The shared secret S = S′ because of the ECDH property: e·K_v = v·E (same secret).
            </AlertBox>
          </div>
        )}
      </Card>
    </div>
  );
}
