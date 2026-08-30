# 2-Minute Demo Script — StealthTag

## ROAD TO DEVCON – IIITN EDITION
Ethereum Research Workshop & Builders Lab · IIIT Nagpur × Bhaisaaab

---

## Demo Prerequisites

| Requirement | Details |
|-------------|---------|
| Running app | `npm run dev` → `http://localhost:3000` |
| Wallet | MetaMask or any injected wallet |
| Network | Sepolia testnet |
| Sepolia ETH | Get from https://sepoliafaucet.com or https://faucet.quicknode.com/ethereum/sepolia |
| API keys | Alchemy RPC + Pimlico + WalletConnect in `.env.local` (or run in Demo Mode) |

---

## The Script

### 0:00–0:20 — The Problem
> "A public Ethereum address is a public ledger. If I share **0xMyAddress**, you can paste it into Etherscan and see **every payment I've ever received** — who paid me, how much, when, and a running balance. For creators, freelancers, and merchants, this is a privacy failure."

**Show:** Open Etherscan on any active Ethereum address. Point to the transaction list.

---

### 0:20–0:40 — The Solution
> "StealthTag gives you **one handle** — a stealth meta-address. Every payment to that handle lands at a **different one-time address** on-chain. An observer sees a bunch of random addresses. They can't link them to me, to each other, or to my handle."

**Show:** Navigate to `/setup`. Show the meta-address — explain it encodes two keys: spending + viewing.

---

### 0:40–1:20 — Live Demo

**Step 1 — Publish handle (1 address → recipient)**
- Show the `/setup` page with meta-address registered on Sepolia
- Copy the handle

**Step 2 — Send 3 payments as a "sender"**
- Navigate to `/send`
- Paste the handle
- Send payment 1 → show stealth address A derived
- Send payment 2 → show **different** stealth address B derived
- Send payment 3 → show **different** stealth address C derived

> "Three payments. Three addresses. None of them look related."

**Step 3 — The challenge** (navigate to `/explore`)
- Show the handle + the 3 one-time addresses side by side
- Challenge the room:
  > **"Here's my handle. Here are the addresses that received my payments. Can you tell how much total I've received? Can you link these addresses to me?"**
- Pause.
- > "You can't. Without my viewing key, the ECDH connection is computationally infeasible."

---

### 1:20–1:50 — Sponsored Sweep (navigate to `/scan`)
> "Now I want to collect my money. But if I send gas from my main wallet to these stealth addresses, I've just linked them — game over."

- Hit **Scan** — scanner runs, detects all 3 payments
- Hit **Sweep** on one payment
  - Show the Paymaster sponsorship message
  - Show transaction confirmed (or simulated in Demo Mode)
> "The Paymaster sponsors the gas. The stealth address **never receives ETH from a known wallet**. That's why Account Abstraction is load-bearing here — not decorative."

**Show:** `[DEMO]` tag if in demo mode — be explicit: "In live mode this is a real Pimlico-sponsored UserOperation."

---

### 1:50–2:00 — Roadmap
> "Future work: batch-sweep 10 addresses in one UserOperation, ENS-mapped handles, private RPC to prevent IP-level scanning correlation, passkey onboarding."

---

## Backup Plan (Demo Mode)

If the bundler or Paymaster is unavailable:
- Set `NEXT_PUBLIC_DEMO_MODE=true` in `.env.local`
- All stealth derivation and detection is **real**
- Only the sweep submission is simulated — and it's **clearly labelled `[DEMO]`**
- Tell the audience: *"The sweep step is simulated here because we're demoing offline, but the cryptography behind it is real."*

---

## Important URLs

| Resource | URL |
|----------|-----|
| Live App | `http://localhost:3000` |
| ERC-5564 Announcer (Sepolia) | https://sepolia.etherscan.io/address/0x55649E01B5Df198D18D95b5cc5051630cfD45564 |
| ERC-6538 Registry (Sepolia) | https://sepolia.etherscan.io/address/0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538 |
| Sepolia faucet | https://sepoliafaucet.com |
| Pimlico dashboard | https://dashboard.pimlico.io |
| ScopeLift SDK | https://github.com/ScopeLift/stealth-address-sdk |

---

## Expected Successful Output

```
Setup page:
  ✓ Two wallet signatures → stealth keys generated
  ✓ Meta-address displayed
  ✓ ERC-6538 registration tx confirmed on Sepolia

Send page (x3):
  ✓ Handle resolved
  ✓ Unique stealth address derived each time
  ✓ ETH sent to stealth address
  ✓ Announcement published to ERC-5564 Announcer

Explore page:
  ✓ Handle + 3 unlinkable addresses shown
  ✓ "Try to link" challenge presented

Scan page:
  ✓ Scanner finds 3 detected payments
  ✓ Sweep → Paymaster-sponsored UserOperation submitted
  ✓ Confirmed (or [DEMO] simulated)
```
