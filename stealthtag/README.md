# ROAD TO DEVCON – IIITN EDITION

### Built At
Ethereum Research Workshop & Builders Lab
**IIIT Nagpur × Bhaisaaab**

---

# StealthTag

**Publish one payment handle. Every payment you receive lands at a different address.**

---

## The Problem

If you publish one wallet address, everyone can see every payment you ever receive — who paid you, how often, and your running balance.

Handing out a fresh address for each payment would fix that, but it's unusable: you'd have to give every payer a new address and then track them all yourself.

StealthTag gives you **one identity you can publish** while each payment quietly goes to **its own fresh address** that only you can find.

---

## How It Works

```
   Sender
     |
     v
   Your stealth meta-address        <- one public handle, share it anywhere
     |
     v
   Fresh stealth address            <- newly derived, unique to this payment
     |
     v
   You detect it with a viewing key <- only you can find it
     |
     v
   EIP-7702 + ERC-4337 sweep        <- gas paid by a Paymaster, not by you
     |
     v
   Destination you choose
```

1. **You publish one handle.** A "stealth meta-address": two public keys joined together. Safe to post publicly.
2. **The sender derives a fresh address.** Their browser combines your handle with a random one-time key (ECDH). Every payment produces a different address, and the sender pays it **directly** — there is no forwarding or decoy wallet in between.
3. **The sender posts a hint on-chain.** A small "announcement" holding a random public key and a 1-byte tag. It does not say who the payment is for.
4. **You scan and detect.** Your *viewing key* checks each announcement. The 1-byte tag discards roughly 255 of every 256 instantly, so scanning stays cheap.
5. **You sweep.** Your *spending key* reconstructs the private key for that one address and moves the funds wherever you choose.

Your **viewing key** can only *find* payments. Your **spending key** is what *moves* them. They are separate, so you could give someone a viewing key for accounting without giving them any ability to spend.

---

## Why ERC-5564?

ERC-5564 is the Ethereum standard for stealth addresses, and Scheme 1 (secp256k1 with view tags) is the deployed version. We use the canonical Announcer contract on Sepolia and ScopeLift's SDK for all elliptic-curve math — no hand-rolled cryptography. ERC-6538 is its companion registry, mapping a normal address to a published handle so senders can look you up.

## Why EIP-7702 + ERC-4337?

Here is the awkward part nobody warns you about: **a stealth address is a plain EOA with no ETH in it.** To move the money it must send a transaction, and to send a transaction it needs gas. Send it gas from your own wallet and you have just published the exact link you were trying to avoid.

The obvious workaround — build a smart account owned by the stealth key — does not work either, because that account lives at a **different address** than the one holding the money.

**EIP-7702 solves it properly.** The stealth EOA signs an authorization that gives it smart-account behaviour *at its own address*. The address that received the payment and the address sending the ERC-4337 UserOperation are then **the same address**. No migration, no extra hop, nothing to correlate.

## Why the Paymaster?

So the stealth address can pay for its own sweep **without first receiving gas from your known wallet**. That is the entire job.

**The Paymaster does not make anything anonymous.** It solves gas, and it *sees* every operation it sponsors. StealthTag also offers a **self-funded** mode where the stealth address pays gas from the ETH it already received — no Paymaster involved at all, which is in fact less correlated.

## Why the Relay?

Without it your browser talks straight to the bundler and the RPC provider, which would see your **IP address** next to every stealth address you scan — and that set of addresses *is* the set of payments belonging to one viewing key.

The relay is a small server-side proxy. Upstream providers see the relay, not you. It also keeps the API key out of the browser entirely.

**The relay is not anonymity.** The relay operator sees exactly what the upstream used to see. Trust moves; it does not disappear. If you don't trust the operator, self-host it — it is one route and two environment variables.

---

## Privacy Model

| Protected | Still Observable |
|---|---|
| Payment-to-payment unlinkability (from announcements alone) | **Amount** — X in, X out is a visible match |
| Known-wallet → stealth-address funding link (there isn't one) | **Timing** — sweeping soon after a payment links them |
| Direct IP exposure to the upstream bundler/RPC | **Destination** — where you sweep to is public |
| A single public address that totals every payment | **Relay operator metadata** — your IP, scans, operations |

Also public and permanent: your **ERC-6538 registration** links your real address to your handle, and every **announcement** shows the sender's wallet.

**StealthTag does not provide anonymity or untraceability, and does not protect against timing, amount, or destination correlation.** The largest hole is the destination — sweep to your public wallet and you undo everything upstream of it. The app warns you when you try.

Full actor-by-actor analysis: [`PRIVACY.md`](./PRIVACY.md). Key handling: [`SECURITY.md`](./SECURITY.md).

---

## Tech Stack

- **ERC-5564** — stealth addresses (Scheme 1, secp256k1 + view tags)
- **ERC-6538** — handle registry
- **EIP-7702** — the stealth EOA becomes its own smart account
- **ERC-4337** — UserOperations via EntryPoint v0.8
- **Pimlico** — bundler + verifying Paymaster
- **TypeScript / Next.js** — app and relay
- **Sepolia** — testnet only

---

## Demo — what a judge should see

1. Open the app.
2. **`/setup`** — connect a wallet, enter a passphrase, derive keys. A `st:eth:0x…` handle appears. Optionally register it on-chain via ERC-6538.
3. **`/send`** — paste that handle and a **fresh stealth address** appears. Click *"Derive a different address"* — **it changes every time.** That is the core property, visible in one click.
4. Send a small amount of Sepolia ETH, then publish the announcement.
5. **`/scan`** — the payment is detected using only the viewing key.
6. Enter a **destination address**. Note the app refuses to default this to your connected wallet, and warns you if you choose it anyway.
7. Choose **sponsored** gas.
8. **Sweep.**
9. Open the sweep on [Sepolia Etherscan](https://sepolia.etherscan.io) and observe: a **type-4 (EIP-7702)** transaction submitted by **Pimlico's bundler**, with the **Paymaster** paying the gas — and **no transaction anywhere funding the stealth address from your wallet**.

**Already verified live on Sepolia** — open these right now:

| What | Where |
|---|---|
| Sponsored sweep (type 4, EntryPoint v0.8) | [`0x49005793…ae131`](https://sepolia.etherscan.io/tx/0x49005793174c338d139893f0d02169fa25edd19e695f82b963bf19d4fe8ae131) |
| Stealth address (delegated, then drained) | [`0xA6F8F2A5…fEDf`](https://sepolia.etherscan.io/address/0xA6F8F2A5f6012d03e72F2E437D5a7058C477fEDf) |
| Paymaster that paid the gas | `0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402` |

---

## Judge Quick Start

### Requirements

- **Node.js 20+** (developed on 24)
- **MetaMask** or any injected wallet — WalletConnect is *optional*; the app works without it
- A little **Sepolia ETH** for the sender side ([faucet](https://sepoliafaucet.com))
- A **Pimlico API key** with Sepolia enabled, for sponsored sweeps

### Install

```bash
npm install --legacy-peer-deps
```

> `--legacy-peer-deps` is required: `permissionless@0.4.0` declares a peer range for `ox` that conflicts with the version `viem@2.56` installs. The conflict is cosmetic.

### Configure

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
PIMLICO_API_KEY=your_key_here        # SERVER-SIDE ONLY — never NEXT_PUBLIC_
RELAY_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

Everything else can stay at its default. Without `PIMLICO_API_KEY` the app runs in **demo mode** and labels sweeps as simulated — it will *not* silently fall back to calling Pimlico from your browser.

### Run

```bash
npm run build && npm start        # http://localhost:3000
```

### Test

Four different kinds of verification. They prove different things, so they are kept separate:

| Kind | Command | What it actually proves | Assertions |
|---|---|---|---|
| **Local unit** | `npm test` | Cryptography, HKDF key management, ERC-5564 derivation/detection, relay security. No chain, no network. | 100 |
| **Local chain (forked)** | `npm run anvil` then `npm run test:sweep` | A full sweep on a **real EVM** — Sepolia forked into anvil, real EntryPoint v0.8, real EIP-7702 delegation, real `handleOps`. | 27 |
| **Automated browser** | `npm start` then `npm run test:ui` | The **real UI** in headless Chromium: hydration, console errors, forms, disabled states, privacy copy, and that the browser makes zero third-party requests. | 73 |
| **Live Sepolia** | `npm run verify:live` | Talks to the **real Pimlico Paymaster** through the relay and obtains a genuine sponsorship quote. **Spends nothing.** | 11 |

The browser suite signs with a real EIP-1193 provider backed by a viem account — real secp256k1 signatures, not canned bytes. Nothing in any suite mocks a StealthTag code path.

**The live sponsored sweep has already been executed on Sepolia** — the transaction links are in the [Demo](#demo--what-a-judge-should-see) section above. To run it again yourself:

```bash
npm run verify:live -- --execute    # spends real Sepolia testnet ETH
```

### The one remaining limitation

**Broadcasting a transaction from the browser requires a funded wallet, so that step is not covered by any automated suite.**

Concretely, `npm run test:ui` exercises `/setup`, `/send` and `/scan` up to the point of submission — deriving keys, resolving handles, generating stealth addresses, validating forms — but its wallet holds no ETH, so ERC-6538 registration, the ETH transfer, the announcement, and the sweep are **not** broadcast from the browser. The suite prints this limitation when it finishes rather than hiding it.

That last mile is covered two other ways: the sweep itself is **verified live on Sepolia** (links above), and end-to-end on a forked chain by `npm run test:sweep`. To close it in the browser, connect MetaMask on Sepolia with a little test ETH and walk through the demo steps manually.

---

## Project Layout

```
lib/keys.ts           domain-separated HKDF key derivation
lib/stealth.ts        ERC-5564 derivation + detection
lib/announcer.ts      ERC-5564 Announcer
lib/registry.ts       ERC-6538 registry
lib/smartAccount.ts   EIP-7702 + ERC-4337 sponsored sweep
lib/relay.ts          client transports (always via the relay)
app/api/relay/        the relay itself — allowlisted JSON-RPC proxy
app/setup|send|scan|explore    the four UI routes
```

## Status

The cryptography, the funding architecture, and the sponsored sweep are **verified live on Sepolia**. The UI is verified by an automated browser suite. Broadcasting a transaction *from the browser* needs a funded wallet — see [The one remaining limitation](#the-one-remaining-limitation).

Testnet only. Not audited. Do not use with real funds.
