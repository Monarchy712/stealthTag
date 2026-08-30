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
  AlertTriangle,
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
import { useScanner } from '@/hooks/useScanner';
import { useSweep } from '@/hooks/useSweep';
import type { DetectedPayment } from '@/types';
import { txUrl } from '@/lib/chain';

export default function ScanPage() {
  const { address, isConnected } = useAccount();
  const { keyBundle, keyState } = useStealthKeys();
  const { detectedPayments, scanning, error: scanError, scan, isDemoMode } = useScanner();
  const { sweepState, sweep, resetSweep, isDemoMode: sweepDemoMode } = useSweep();

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
    return (
      <PageShell>
        <div className="text-center py-24">
          <Key className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">No stealth keys found</h2>
          <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">
            You need to generate your stealth keys before you can scan for payments.
          </p>
          <Link href="/setup">
            <Button>
              Go to Setup
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </PageShell>
    );
  }

  async function handleScan() {
    if (!keyBundle) return;
    await scan(keyBundle);
  }

  async function handleSweep(payment: DetectedPayment, idx: number) {
    if (!address) return;
    setSweepingIdx(idx);
    resetSweep();
    await sweep(payment, address);
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
        subtitle="Detect incoming payments to your stealth addresses and sweep them to your wallet — gas sponsored by Paymaster."
      />

      {/* Demo mode banner */}
      {isDemoMode && (
        <AlertBox type="demo" title="🎭 Demo Mode">
          No Pimlico API key detected. The scanner shows pre-seeded demo payments
          and the sweep is <strong>simulated</strong> — clearly marked. Add your
          NEXT_PUBLIC_PIMLICO_API_KEY to enable real on-chain sweeps.
        </AlertBox>
      )}

      {/* AA explanation */}
      <Card className="mt-4 bg-indigo-950/20 border-indigo-800/30">
        <div className="flex items-start gap-3">
          <Zap className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-white mb-1">
              Why is gas sponsored?
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Sweeping from a stealth address requires gas <em>at that address</em>.
              Funding it from your main wallet links the two addresses — destroying
              privacy. The <strong className="text-indigo-400">Paymaster sponsors the gas</strong> so
              the stealth address is never funded from a known wallet.
              This is a sponsored transaction, not a "free" one — Ethereum still
              consumes gas; the Paymaster covers the cost on your behalf.
            </p>
          </div>
        </div>
      </Card>

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
          <Button onClick={handleScan} loading={scanning}>
            <Radar className="w-4 h-4" />
            {scanning ? 'Scanning…' : detectedPayments.length > 0 ? 'Rescan' : 'Scan now'}
          </Button>
        </div>

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
              : 'No payments detected yet. Send some test ETH to your handle first.'}
          </p>
        )}
      </Card>

      {/* Detected payments */}
      {detectedPayments.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-3">
            <StepNumber n={2} />
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
                recipientAddress={address!}
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
  recipientAddress,
}: {
  payment: DetectedPayment;
  idx: number;
  isDemoMode: boolean;
  isSwept: boolean;
  isSweeping: boolean;
  sweepState: ReturnType<typeof useSweep>['sweepState'];
  onSweep: () => void;
  recipientAddress: string;
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
              disabled={isSweeping || isSwept}
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
              Building UserOperation → requesting Paymaster sponsorship…
            </p>
          )}
          {sweepState.status === 'submitted' && (
            <p className="text-xs text-gray-500 mt-1">
              Submitted to Pimlico bundler → waiting for EntryPoint confirmation…
            </p>
          )}
          {sweepState.status === 'confirmed' && sweepState.isSimulated && (
            <p className="text-xs text-orange-400 mt-1">
              [DEMO] This sweep was simulated. In live mode, the Paymaster sponsors real gas
              so this stealth address is never funded from your known wallet.
            </p>
          )}
          {sweepState.status === 'confirmed' && !sweepState.isSimulated && (
            <p className="text-xs text-emerald-400 mt-1">
              ✓ Gas sponsored by Paymaster — stealth address was never linked to your wallet.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto px-4 py-12">{children}</div>;
}
