# PITCH.md — StealthTag

## ROAD TO DEVCON – IIITN EDITION
Ethereum Research Workshop & Builders Lab · IIIT Nagpur × Bhaisaaab

---

## Project Name
**StealthTag**

---

## One-Line Pitch
> Publish one payment handle. Receive every payment at a fresh one-time address that observers cannot link to each other from the announcements alone.

---

## The Problem

Public Ethereum addresses are public balance sheets. The moment you share `0xYourAddress`:
- Anyone can see every payment you've received and the senders
- Your total balance is calculable in real time
- Your payment graph (who paid you, how often, how much) is permanently reconstructable

This is a fundamental UX and privacy failure for creators, freelancers, merchants, and anyone who accepts on-chain payments.

---

## The Solution

**StealthTag** solves this with two standards working together:

1. **ERC-5564 Stealth Addresses** — Each payment is directed to a fresh one-time address derived via ECDH from the recipient's public handle. The addresses look like random Ethereum addresses to observers.

2. **ERC-6538 Registry** — Maps a standard Ethereum address to a stealth meta-address (the "handle"), so senders have a single place to look up where to derive the stealth address.

3. **ERC-4337 Sponsored Sweep** — The recipient detects payments using a viewing key, then sweeps them via a Paymaster-sponsored UserOperation — so no stealth address is ever funded from a known wallet (which would link them).

---

## Target Users

- **Creators** — Accept donations without exposing earnings
- **Freelancers** — Invoice from one handle without publishing a single address that totals every client payment
- **Merchants** — Accept on-chain payments without revealing sales volume
- **Anyone** — Who wants to receive payments without publishing a permanent identity

---

## Why Ethereum?

- ERC-5564 and ERC-6538 are Ethereum-native standards with canonical deployments
- ERC-4337 smart accounts and paymasters are live on Sepolia
- Transparent ledger + stealth addresses = payments that cannot be linked to each other from on-chain announcements alone (ECDH-backed)
- Composable: ENS, smart accounts, and stealth addresses work together natively

---

## Why Account Abstraction?

**This is load-bearing, not decorative.**

Sweeping from a stealth address requires gas at that address. Funding it from your main wallet publishes a link between them. A Pimlico **Verifying Paymaster** sponsors the gas for the sweep UserOperation, and EIP-7702 makes the stealth EOA itself the ERC-4337 sender, so the stealth address is never funded from a known wallet. Sponsorship solves gas; it is not a privacy mechanism on its own.

Without AA, the stealth scheme would require either:
- Losing privacy at the sweep step, or
- Complex off-chain coordination to fund gas privately

AA makes the scheme practical.

---

## Main Innovation

> **Unlinkable payment receiving via one published handle, made sweep-practical by a sponsored Paymaster.**

Each payment to the same handle lands at a distinct on-chain address that observers cannot group from the announcements alone. The recipient finds them all with one viewing-key scan and sweeps them with sponsored UserOperations, so no stealth address ever needs gas from a known wallet.

What third parties still learn, stated plainly: the **relay** sees the user's IP, the addresses scanned, and every UserOperation; the **bundler and Paymaster** see each sponsored operation and can group them by API key; **chain observers** see amounts, timing, and the sweep destination. StealthTag reduces linkability between payments — it does not make anyone anonymous. See `PRIVACY.md` for the actor-by-actor breakdown.

---

## Architecture (condensed)

```
Sender → ERC-6538 Registry (resolve handle)
       → ScopeLift SDK (ECDH derive one-time address)
       → send ETH to stealth address
       → ERC-5564 Announcer (publish ephemeral pubkey + view tag)

Recipient ← ERC-5564 Announcer (scan events)
          ← ScopeLift SDK (view-tag filter + ECDH detect)
          → Kernel v3 Smart Account
          → UserOperation
          → Pimlico Bundler
          → EntryPoint
          ↑ Pimlico Paymaster sponsors gas
```

---

## Demo Flow (2 minutes)

1. Show the handle (one meta-address, published)
2. Send 3 payments → 3 distinct one-time addresses derived
3. Open Explorer page → challenge the audience to link them
4. Scan → 3 payments detected via viewing key
5. Sweep → Paymaster sponsors gas → funds collected
6. Challenge stands: observer still can't link the addresses

---

## Challenges

- Wagmi v2/v3 peer dependency conflicts with RainbowKit (solved with `--legacy-peer-deps`)
- permissionless.js API surface changes between versions
- ScopeLift SDK `checkStealthAddress` expects specific encoding for metadata view tags
- Demo mode needed to allow judges to experience the UI without a live bundler

---

## Future Roadmap

| Feature | Impact |
|---------|--------|
| Batch sweep (N addresses in 1 UserOp) | Fewer transactions, lower total cost |
| ENS-mapped handles (`you.eth` → meta-address) | Human-readable payment addresses |
| Relayed RPC scanning | Reduce IP-level correlation with the upstream provider (the relay operator still sees it) |
| Passkey/social login | No EOA required for recipients |
| Amount splitting | Reduce amount-correlation attack surface |
| Multi-chain | Base, Arbitrum, Optimism |

---

## Privacy Properties & Observables

### What StealthTag Provides
- ✅ **Unlinkability of received payments** to the recipient's identity and to each other.
- ✅ **Balance non-disclosure** — the recipient's total balance is not exposed through a single public address.

### What Remains Observable On-Chain
1. **Transfer amounts are public** — enables amount-correlation if round/matching values are sent.
2. **ERC-6538 registration links EOA to meta-address** on-chain (mitigation: register via fresh EOA or share off-chain).
3. **Announcements are public events** — count, frequency, and block timestamps are visible.
4. **Network/RPC metadata** — IP addresses observable without a privacy relay.

---

## Built During

**ROAD TO DEVCON – IIITN EDITION**  
Ethereum Research Workshop & Builders Lab  
IIIT Nagpur × Bhaisaaab
