# StealthTag — Architecture

## ROAD TO DEVCON – IIITN EDITION
Ethereum Research Workshop & Builders Lab · IIIT Nagpur × Bhaisaaab

---

## System Overview

```
USER
 │
 ▼
NEXT.JS FRONTEND (React, TypeScript, Tailwind)
 │         │
 │         ├── STEALTH LAYER (ERC-5564 / ERC-6538)
 │         │    ├── @scopelift/stealth-address-sdk (ECDH derivation & detection)
 │         │    ├── ERC-5564 Announcer contract (Sepolia)
 │         │    └── ERC-6538 Registry contract (Sepolia)
 │         │
 │         └── SMART ACCOUNT LAYER (ERC-4337)
 │              ├── permissionless.js (Kernel v3 smart account)
 │              ├── Pimlico Bundler (UserOperation submission)
 │              ├── EntryPoint (ERC-4337 singleton)
 │              └── Pimlico Paymaster (gas sponsorship)
 │
wagmi / viem (wallet connection & raw RPC)
```

---

## Component Breakdown

### Frontend (Next.js App Router)

| Route | Purpose |
|-------|---------|
| `/` | Landing page — explains the concept |
| `/setup` | Key generation + ERC-6538 registration |
| `/send` | Sender: derive stealth address, send ETH, publish announcement |
| `/scan` | Recipient: scan announcements, detect, sweep |
| `/explore` | Unlinkability demo — the "find the link" challenge |

### Library Layer (`lib/`)

| File | Responsibility |
|------|---------------|
| `chain.ts` | Contract addresses, ABIs, viem clients, Pimlico URLs |
| `keys.ts` | Domain-separated HKDF key derivation (see `SECURITY.md`) |
| `stealth.ts` | Meta-address encode/parse, `deriveStealthAddress`, `scanAnnouncements`, `detectPayment` |
| `registry.ts` | ERC-6538 `registerKeys` + `stealthMetaAddressOf` |
| `announcer.ts` | ERC-5564 `announce` + `getLogs` for scanning |
| `smartAccount.ts` | EIP-7702 stealth account (address == stealth address), `sponsoredSweep`, `simulateSweep` |
| `relay.ts` | Client transports pointing at the relay instead of Pimlico/RPC |
| `relayConfig.ts` | Relay targets + JSON-RPC method allowlists (shared client/server) |
| `demo.ts` | Pre-seeded demo data, bundler delay simulation |
| `wagmi.ts` | wagmi + RainbowKit config |

### Hooks (`hooks/`)

| Hook | Responsibility |
|------|---------------|
| `useStealthKeys` | Derives spending/viewing keypair (wallet signature + passphrase); persists only the public half |
| `useScanner` | Fetches Announcer events, runs detection, manages state |
| `useSweep` | Executes the EIP-7702 sweep (sponsored or self-funded) via the relay, or simulates it |

---

## Data Flow — Sender

```
Sender types handle → resolveMetaAddress (ERC-6538 Registry)
                                │
                       parseMetaAddress → spending pubkey + viewing pubkey
                                │
                    deriveStealthAddress (ScopeLift SDK)
                        ├── Generate ephemeral keypair (e, E)
                        ├── ECDH: S = e × K_spend
                        ├── h = keccak256(S)
                        ├── stealthAddr = (h × G) + K_spend
                        └── viewTag = h[0]
                                │
                    sendTransaction(to: stealthAddr, value: amount)
                                │
                    publishAnnouncement(stealthAddr, E, viewTag)
                        → ERC-5564 Announcer.announce(schemeId=1, ...)
```

---

## Data Flow — Recipient

```
Recipient hits Scan
        │
fetchAnnouncements (getLogs from ERC-5564 Announcer)
        │
for each announcement:
    checkStealthAddress (ScopeLift SDK)
        ├── S′ = viewingKey × E  (ECDH — same secret as sender's S)
        ├── h′ = keccak256(S′)
        ├── check viewTag match (first byte)   ← 256× speedup
        └── reconstruct stealthAddr, confirm match
        │
computeStealthKey → stealthPrivateKey = h′ + spendingPrivateKey (mod curve order)
        │
DetectedPayment { stealthAddress, stealthPrivateKey, balance, ... }
```

---

## Data Flow — Sponsored Sweep

```
Recipient selects payment to sweep
        │
sponsoredSweep(payment, toAddress)
        │
privateKeyToAccount(stealthPrivateKey)  ← uses stealth key as signer
        │
signerToEcdsaKernelSmartAccount(publicClient, { signer: stealthAccount })
        │     ↑ Kernel v3 counterfactual smart account
        │
createSmartAccountClient({ middleware: { sponsorUserOperation: pimlico.sponsorUserOperation } })
        │     ↑ Paymaster attached here — sponsors gas for this UserOp
        │
smartAccountClient.sendTransaction({ to: recipientWallet, value: balance })
        │
UserOperation constructed → Pimlico Bundler → EntryPoint (ERC-4337)
        │
EntryPoint validates + executes → funds transferred to recipient
        │
⚠️  Stealth address NEVER received ETH for gas — Paymaster covered it.
    This is what preserves unlinkability.
```

---

## Privacy vs. AA Separation

This is critical:

| Concern | Technology | Mechanism |
|---------|-----------|-----------|
| **Unlinkability of payments** | ERC-5564 stealth addresses | ECDH-derived one-time addresses |
| **Balance non-disclosure** | ERC-5564 + ERC-6538 | Only recipient can detect payments |
| **Efficient scanning** | ERC-5564 view tags | 1-byte prefix → 256× scan speedup |
| **Meta-address registration** | ERC-6538 Registry | On-chain handle → meta-address map |
| **Sweep without linking** | ERC-4337 Paymaster | Gas sponsored → stealth addr never funded |

**Account Abstraction does NOT provide privacy.** It provides the sponsored sweep that keeps stealth addresses unlinkable to known wallets.

---

## Contracts Used (Sepolia)

| Contract | Address | Source |
|----------|---------|--------|
| ERC-5564 Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` | ScopeLift canonical |
| ERC-6538 Registry | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` | ScopeLift canonical |
| ERC-4337 EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ERC-4337 standard |
| Pimlico Verifying Paymaster | Managed by Pimlico | Pimlico hosted |
| Kernel v3 Smart Account | Counterfactual per signer | ZeroDev |

---

## Key Design Decisions

### Why not hand-roll the ECDH?
secp256k1 crypto is subtle. A single implementation bug destroys privacy or security. We use ScopeLift's audited SDK.

### Why Kernel v3 / permissionless.js?
Kernel is a widely used ERC-4337 smart account with good tooling. permissionless.js provides a clean TypeScript interface over it.

### Why Pimlico?
Pimlico has a free-tier bundler and verifying paymaster on Sepolia — no infra to run. The hackathon vibes are immaculate.

### Why Sepolia (not Base Sepolia)?
Both the ScopeLift canonical contracts and Pimlico's Sepolia infrastructure are available. One chain = simpler demo.

### Why not store keys server-side?
Keys are re-derivable from a wallet signature plus the user's passphrase, so nothing needs to be custodied. No server, no custody, no trust required. Only the public half of the bundle is persisted locally; the private keys live in session memory. See `SECURITY.md` for the full key-management model and its residual risks.
