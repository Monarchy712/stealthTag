'use client';

/**
 * app/scan/page.tsx — Recipient scanner + sponsored sweep
 *
 * Steps:
 *  1. Ensure stealth keys are generated (delegate to /setup if not)
 *  2. Scan the ERC-5564 Announcer for announcements
 *  3. Filter by view tag + detect with viewing key
 *  4. Display detected payments
 *  5. Sweep selected payments via Paymaster-sponsored UserOperation
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatEther } from 'viem';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Key,
  Radar,
  Wallet,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import {
  AlertBox,
  Badge,
  Button,
  Card,
  Divider,
  SectionHeading,
  Spinner,
  StepNumber,
  TxStatusBadge,
} from '@/components/ui';
import { useStealthKeys } from '@/hooks/useStealthKeys';
import { useScanner, DEFAULT_SCAN_BLOCKS } from '@/hooks/useScanner';
import { useSweep } from '@/hooks/useSweep';
import type { DetectedPayment } from '@/types';
import type { GasMode } from '@/lib/smartAccount';

export default function ScanPage() {
  const { address, isConnected } = useAccount();
  const { keyBundle, keyState } = useStealthKeys();
  const { detectedPayments, scanning, error: scanError, scan, lastScan, isDemoMode } =
    useScanner();
  const {
    sweepState,
    sweep,
    resetSweep,
    lastResult,
    relayStatus,
    isDemoMode: sweepDemoMode,
  } = useSweep();

  // Deliberately NOT defaulted to the connected wallet: the destination is the
  // single largest on-chain correlation risk, so the user must choose it.
  const [destination, setDestination] = useState('');

  // Sponsored vs self-funded gas is a genuine privacy tradeoff, so it is the
  // user's choice rather than a hidden default. See PRIVACY.md §3.
  const [gasMode, setGasMode] = useState<GasMode>('sponsored');

  // How far back to scan. Explicit and adjustable: the RPC caps eth_getLogs
  // ranges, so a bounded scan is a provider constraint — and a user must never
  // read "nothing found" as "nothing was ever sent".
  const [lookBack, setLookBack] = useState<string>(DEFAULT_SCAN_BLOCKS.toString());

  const [sweepingIdx, setSweepingIdx] = useState<number | null>(null);
  const [swept, setSwept] = useState<Record<string, string>>({}); // addr → txHash

  if (!isConnected) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-6 py-24">
          <Wallet className="w-12 h-12 text-gray-600" />
          <p className="text-gray-400">Connect your wallet to scan for payments</p>
          <ConnectButton />
        </div>
      </PageShell>
    );
  }

  if (keyState !== 'generated' || !keyBundle) {
    const locked = keyState === 'locked';
    return (
      <PageShell>
        <div className="text-center py-24">
          <Key className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">
            {locked ? 'Stealth keys locked' : 'No stealth keys found'}
          </h2>
          <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">
            {locked
              ? 'Your viewing key is never stored on disk. Re-derive it with your wallet signature and passphrase to scan for payments.'
              : 'You need to derive your stealth keys before you can scan for payments.'}
          </p>
          <Link href="/setup">
            <Button>
              {locked ? 'Unlock keys' : 'Go to Setup'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
        <SponsorshipPanel />
      </PageShell>
    );
  }

  async function handleScan() {
    if (!keyBundle) return;
    const parsed = BigInt(Number.parseInt(lookBack, 10) || Number(DEFAULT_SCAN_BLOCKS));
    await scan(keyBundle, parsed > 0n ? parsed : DEFAULT_SCAN_BLOCKS);
  }

  const destinationIsValid = /^0x[0-9a-fA-F]{40}$/.test(destination.trim());
  const destinationIsKnownWallet =
    destinationIsValid && destination.trim().toLowerCase() === address?.toLowerCase();

  async function handleSweep(payment: DetectedPayment, idx: number) {
    if (!destinationIsValid) return;
    setSweepingIdx(idx);
    resetSweep();
    await sweep(payment, destination.trim() as `0x${string}`, gasMode);
    if (sweepState.status === 'confirmed' || sweepDemoMode) {
      setSwept((prev) => ({ ...prev, [payment.stealthAddress]: 'done' }));
    }
    setSweepingIdx(null);
  }

  return (
    <PageShell>
      <SectionHeading
        badge="ERC-5564 Scanner + ERC-4337 Sweep"
        title="Scan & Sweep"
        subtitle="Detect incoming payments to your stealth addresses and sweep them to a destination you choose — gas sponsored by a Paymaster, submitted through the relay."
      />

      {/* Demo mode banner */}
      {isDemoMode && (
        <AlertBox type="demo" title="🎭 Demo Mode">
          {relayStatus === 'unconfigured'
            ? 'The relay is not configured (no server-side PIMLICO_API_KEY / RELAY_RPC_URL), so the sweep is '
            : 'Demo mode is forced by NEXT_PUBLIC_DEMO_MODE, so the sweep is '}
          <strong>simulated</strong> — clearly marked, no transaction is submitted.
          StealthTag deliberately does <em>not</em> fall back to calling Pimlico
          directly from your browser: that would show the bundler your IP next to
          the stealth address, which is exactly what the relay exists to prevent.
        </AlertBox>
      )}

      <SponsorshipPanel />

      {/* Scanner */}
      <Card className="mt-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <StepNumber n={1} />
            <div>
              <h3 className="font-bold text-white">Scan for payments</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Watches the ERC-5564 Announcer — view-tag filter + ECDH detection
              </p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="look-back" className="block text-[11px] text-gray-500 mb-1">
                Blocks to scan
              </label>
              <input
                id="look-back"
                type="number"
                min="1"
                step="1000"
                value={lookBack}
                onChange={(e) => setLookBack(e.target.value)}
                disabled={scanning}
                className="w-28 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm
                           text-gray-200 font-mono focus:outline-none focus:border-indigo-600"
              />
            </div>
            <Button onClick={handleScan} loading={scanning}>
              <Radar className="w-4 h-4" />
              {scanning ? 'Scanning…' : detectedPayments.length > 0 ? 'Rescan' : 'Scan now'}
            </Button>
          </div>
        </div>

        {!isDemoMode && (
          <AlertBox type="info">
            <p className="text-xs leading-relaxed">
              This scans only the <strong>last {Number(lookBack).toLocaleString()} blocks</strong>
              {' '}(~{Math.round((Number(lookBack) * 12) / 3600)}h on Sepolia). Public RPC providers
              cap <code>eth_getLogs</code> ranges, so the window is bounded by the provider, not by
              StealthTag. <strong>&ldquo;No payments found&rdquo; means none in this window</strong> —
              not that none exist. Increase the range to look further back.
            </p>
          </AlertBox>
        )}

        {lastScan && !scanning && (
          <p className="text-[11px] text-gray-500 mt-3 font-mono">
            Last scan: blocks {lastScan.fromBlock.toString()} → {lastScan.toBlock.toString()} (
            {lastScan.blocksScanned.toString()} blocks, {lastScan.announcementsSeen} announcement
            {lastScan.announcementsSeen === 1 ? '' : 's'} seen,{' '}
            {detectedPayments.length} for you)
          </p>
        )}

        {scanning && (
          <div className="flex items-center gap-3 py-6 justify-center">
            <Spinner className="w-5 h-5 text-indigo-400 scan-pulse" />
            <p className="text-sm text-gray-400 scan-pulse">
              Scanning ERC-5564 Announcer events…
            </p>
          </div>
        )}

        {scanError && (
          <AlertBox type="error" title="Scan error">
            {scanError}
          </AlertBox>
        )}

        {!scanning && detectedPayments.length === 0 && !scanError && (
          <p className="text-center text-gray-600 text-sm py-6">
            {isDemoMode
              ? 'Click Scan now to load demo payments'
              : lastScan
              ? `No payments for you in the last ${lastScan.blocksScanned.toString()} blocks. Increase the range above to look further back.`
              : 'Click Scan now to search the ERC-5564 Announcer for payments to your handle.'}
          </p>
        )}
      </Card>

      {/* Sweep destination — explicit, never defaulted */}
      {detectedPayments.length > 0 && (
        <Card className="mt-4">
          <div className="flex items-center gap-3 mb-3">
            <StepNumber n={2} />
            <div>
              <h3 className="font-bold text-white">Choose a sweep destination</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                This address is published on-chain next to the stealth address
              </p>
            </div>
          </div>

          <label htmlFor="sweep-destination" className="block text-xs text-gray-500 mb-1">
            Destination address
          </label>
          <input
            id="sweep-destination"
            type="text"
            spellCheck={false}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="0x… (an address not publicly tied to you)"
            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm
                       text-gray-200 font-mono placeholder:text-gray-700 focus:outline-none
                       focus:border-indigo-600"
          />

          {destination.length > 0 && !destinationIsValid && (
            <p className="text-xs text-red-400 mt-1.5">Not a valid 20-byte address.</p>
          )}

          {destinationIsKnownWallet && (
            <AlertBox type="warning" title="This is your connected wallet">
              Sweeping here publishes <span className="font-mono">stealthAddress → yourWallet</span>{' '}
              on-chain, and the amounts will match. Anyone reading the chain can then link this
              payment — and, via your ERC-6538 registration, your published handle — to your public
              wallet. Gas sponsorship does not prevent this. Use a destination that is not already
              associated with your identity.
            </AlertBox>
          )}

          {address && (
            <button
              onClick={() => setDestination(address)}
              className="mt-2 text-xs text-gray-600 hover:text-gray-400 underline"
            >
              Use my connected wallet anyway (not recommended)
            </button>
          )}

          <Divider label="Who pays the gas" />

          <div className="grid sm:grid-cols-2 gap-2">
            {(
              [
                {
                  mode: 'sponsored' as GasMode,
                  title: 'Paymaster sponsored',
                  body: 'Sweeps 100%, works for dust and ERC-20s. The Paymaster address appears on-chain in every sponsored sweep, and the sponsor sees this operation.',
                },
                {
                  mode: 'self-funded' as GasMode,
                  title: 'Self-funded from the payment',
                  body: 'The stealth address pays its own gas from the ETH it received. No Paymaster is involved, so one observer disappears. Leaves a small residue and needs the payment to exceed gas.',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setGasMode(opt.mode)}
                className={`text-left rounded-xl p-3 border transition-colors ${
                  gasMode === opt.mode
                    ? 'border-indigo-600 bg-indigo-950/30'
                    : 'border-gray-800 bg-gray-950 hover:border-gray-700'
                }`}
              >
                <p className="text-xs font-semibold text-white mb-1">{opt.title}</p>
                <p className="text-[11px] text-gray-500 leading-relaxed">{opt.body}</p>
              </button>
            ))}
          </div>

          <p className="text-[11px] text-gray-600 mt-2">
            Neither option is anonymity. Both leave the sweep itself public on-chain.
          </p>
        </Card>
      )}

      {/* Detected payments */}
      {detectedPayments.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-3">
            <StepNumber n={3} />
            <h3 className="font-bold text-white">
              Detected payments{' '}
              <span className="text-indigo-400">({detectedPayments.length})</span>
            </h3>
          </div>

          <div className="space-y-3">
            {detectedPayments.map((payment, idx) => (
              <DetectedPaymentCard
                key={payment.stealthAddress}
                payment={payment}
                idx={idx}
                isDemoMode={isDemoMode}
                isSwept={!!swept[payment.stealthAddress]}
                isSweeping={sweepingIdx === idx}
                sweepState={sweepingIdx === idx ? sweepState : { status: 'idle' }}
                onSweep={() => handleSweep(payment, idx)}
                destination={destination.trim()}
                canSweep={destinationIsValid}
                lastResult={sweepingIdx === idx ? lastResult : null}
              />
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ── Detected Payment Card ─────────────────────────────────────
function DetectedPaymentCard({
  payment,
  idx,
  isDemoMode,
  isSwept,
  isSweeping,
  sweepState,
  onSweep,
  destination,
  canSweep,
  lastResult,
}: {
  payment: DetectedPayment;
  idx: number;
  isDemoMode: boolean;
  isSwept: boolean;
  isSweeping: boolean;
  sweepState: ReturnType<typeof useSweep>['sweepState'];
  onSweep: () => void;
  destination: string;
  canSweep: boolean;
  lastResult: ReturnType<typeof useSweep>['lastResult'];
}) {
  const balance = payment.balance ?? 0n;
  const balanceEth = parseFloat(formatEther(balance)).toFixed(6);

  return (
    <Card className={isSwept ? 'opacity-60' : ''}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant={isDemoMode ? 'demo' : 'success'}>
              {isDemoMode ? '[DEMO]' : 'Detected'}
            </Badge>
            <Badge variant="info">Payment #{idx + 1}</Badge>
            {isSwept && <Badge variant="success">Swept ✓</Badge>}
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-gray-500">One-time stealth address:</span>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="font-mono text-violet-300 break-all">{payment.stealthAddress}</p>
                <a
                  href={`https://sepolia.etherscan.io/address/${payment.stealthAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-gray-400 flex-shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <div>
              <span className="text-gray-500">Balance:</span>
              <span className="text-white font-medium ml-2">
                {isDemoMode
                  ? formatEther(balance) + ' ETH (simulated)'
                  : `${balanceEth} ETH`}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Block:</span>
              <span className="text-gray-400 ml-2">#{payment.blockNumber.toString()}</span>
            </div>
          </div>
        </div>

        {/* Sweep button */}
        <div className="flex-shrink-0">
          {isSwept ? (
            <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Swept
            </div>
          ) : (
            <Button
              onClick={onSweep}
              loading={isSweeping}
              disabled={isSweeping || isSwept || !canSweep}
              title={canSweep ? undefined : 'Enter a destination address first'}
              size="sm"
            >
              <Zap className="w-3.5 h-3.5" />
              Sweep
            </Button>
          )}
        </div>
      </div>

      {isSweeping && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <TxStatusBadge state={sweepState} />
          {sweepState.status === 'pending' && (
            <p className="text-xs text-gray-500 mt-1">
              Building EIP-7702 UserOperation → requesting Paymaster sponsorship via the relay…
            </p>
          )}
          {sweepState.status === 'submitted' && (
            <p className="text-xs text-gray-500 mt-1">
              Signed locally with the stealth key → relayed to the bundler → waiting for
              EntryPoint v0.8 inclusion…
            </p>
          )}
          {sweepState.status === 'confirmed' && sweepState.isSimulated && (
            <p className="text-xs text-orange-400 mt-1">
              [DEMO] Simulated — nothing was submitted. In live mode the stealth address itself
              sends a sponsored UserOperation, so it never needs gas from your known wallet.
            </p>
          )}
          {sweepState.status === 'confirmed' && !sweepState.isSimulated && (
            <div className="text-xs mt-1 space-y-1">
              <p className="text-emerald-400">
                ✓ Swept. Gas was paid by the Paymaster — this stealth address was never funded
                from your wallet.
              </p>
              {lastResult && (
                <p className="text-gray-500 font-mono break-all">
                  {lastResult.from} → {lastResult.to}
                </p>
              )}
              <p className="text-amber-400/90">
                Now public on-chain: this stealth address paid{' '}
                <span className="font-mono">{destination.slice(0, 10)}…</span>. That link is
                permanent and sponsorship does not hide it.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}


// ── What sponsorship does and does not do ─────────────────────
// Rendered on the gated view too: a user who has not yet derived keys is
// exactly the user most likely to misread "gas sponsored" as "anonymous".
function SponsorshipPanel() {
  return (
  <Card className="mt-4 bg-indigo-950/20 border-indigo-800/30">
    <div className="flex items-start gap-3">
      <Zap className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
      <div className="space-y-2">
        <p className="text-sm font-semibold text-white">
          Three separate things — only one of them is privacy
        </p>
        <ul className="text-xs text-gray-400 leading-relaxed space-y-1.5">
          <li>
            <strong className="text-indigo-300">Stealth addresses (ERC-5564)</strong> give
            unlinkability <em>between payments</em>. Each payment lands at a fresh address.
          </li>
          <li>
            <strong className="text-indigo-300">Paymaster sponsorship</strong> solves{' '}
            <em>gas</em>, nothing more. Your stealth address is an EOA with no ETH for fees;
            funding it from your main wallet would publish the link. EIP-7702 lets the stealth
            address itself execute a sponsored UserOperation, so it never needs that transfer.
          </li>
          <li>
            <strong className="text-indigo-300">The relay</strong> reduces <em>network</em>{' '}
            correlation: Pimlico and the RPC provider see the relay server, not your IP. The
            relay operator still sees it. This is a trust boundary, not anonymity.
          </li>
        </ul>
        <p className="text-xs text-amber-400/90 leading-relaxed pt-1">
          None of this hides the sweep itself. Whatever address you sweep to is published
          on-chain right next to the stealth address, and the amounts match. Sweeping to
          your public wallet re-links everything.
        </p>
      </div>
    </div>
  </Card>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto px-4 py-12">{children}</div>;
}
