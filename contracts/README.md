# Contracts

> **StealthTag deploys no contracts of its own. Nothing in this folder was written or deployed by this project.**
>
> These are **reference interfaces** for the five canonical, already-deployed contracts StealthTag integrates with, reproduced so a reviewer can read the on-chain surface without leaving the repo. Each file names its upstream source and its live address.

---

## The five contracts

| # | Contract | Address (Sepolia) | Who deployed it | What it does here |
|---|---|---|---|---|
| 1 | **ERC-5564 Announcer** | [`0x55649E01…D45564`](https://sepolia.etherscan.io/address/0x55649E01B5Df198D18D95b5cc5051630cfD45564) | ScopeLift (canonical) | Sender publishes the ephemeral key + view tag so the recipient can scan |
| 2 | **ERC-6538 Registry** | [`0x6538E6bf…5d6538`](https://sepolia.etherscan.io/address/0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538) | ScopeLift (canonical) | Maps a normal address → published stealth meta-address |
| 3 | **EntryPoint v0.8** | [`0x4337084D…5Ff108`](https://sepolia.etherscan.io/address/0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108) | eth-infinitism (canonical) | Executes the ERC-4337 UserOperation. v0.8 because EIP-7702 requires it |
| 4 | **Simple7702Account** | [`0xe6Cae83B…08555B`](https://sepolia.etherscan.io/address/0xe6Cae83BdE06E4c305530e199D7217f42808555B) | eth-infinitism (canonical) | The EIP-7702 delegate. **The key architectural piece** — see below |
| 5 | **Pimlico Paymaster** | [`0x88888888…3D2402`](https://sepolia.etherscan.io/address/0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402) | Pimlico | Pays gas for the sweep so the stealth address needs no funding |

All five are checked for deployed bytecode at test time by `npm run test:relay`, and were confirmed live at byte sizes 709 / 3,147 / 21,738 / 3,639 / 14,796.

---

## Why we deploy nothing

This is a deliberate design decision, not a missing piece.

Stealth-address cryptography is the part that is easy to get subtly and catastrophically wrong — a mistake in ECDH derivation or view-tag handling silently loses funds or silently destroys the privacy property, and neither failure is visible from a passing test. So StealthTag uses the audited canonical deployments plus ScopeLift's SDK for **all** elliptic-curve math.

Writing a bespoke Announcer or a custom stealth scheme would add attack surface, break interoperability with every other ERC-5564 wallet, and solve nothing.

**The engineering contribution is off-chain:**

1. **The EIP-7702 reconciliation.** An ERC-5564 stealth address is a plain EOA holding ETH with no way to pay for its own first transaction. The obvious fix — a smart account owned by the stealth key — fails, because that account is at a *different address* than the funds. EIP-7702 delegates the EOA's code in place, so the address that received the payment **is** the ERC-4337 `sender`. No migration hop, nothing extra to correlate.
2. **Domain-separated HKDF key management** (`stealthtag/lib/keys.ts`) — replacing a scheme where signing a public fixed message reconstructed both stealth private keys.
3. **The relay boundary** (`stealthtag/app/api/relay/`) — keeps the user's IP and the API key away from the bundler and RPC provider.

---

## Interface files

| File | Mirrors | Used by |
|---|---|---|
| `interfaces/IERC5564Announcer.sol` | `ANNOUNCER_ABI` | `lib/announcer.ts` |
| `interfaces/IERC6538Registry.sol` | `REGISTRY_ABI` | `lib/registry.ts` |
| `interfaces/IEntryPointV08.sol` | EntryPoint v0.8 (subset) | `lib/smartAccount.ts`, `scripts/test-sweep-local.ts` |
| `interfaces/ISimple7702Account.sol` | Simple7702Account | the 7702 delegation target |
| `interfaces/IPaymaster.sol` | ERC-4337 paymaster | sponsored sweeps |

Only the members StealthTag actually calls are reproduced. They are **reference material** — the app calls these contracts through viem ABIs in `stealthtag/lib/chain.ts`, not through compiled Solidity, so nothing here is part of the build.

---

## Proof it works on-chain

The full path — stealth EOA → EIP-7702 authorization → UserOperation → relay → Pimlico bundler → EntryPoint v0.8 → Paymaster → destination — was **executed live on Sepolia**:

| | |
|---|---|
| Sweep transaction | [`0x49005793…ae131`](https://sepolia.etherscan.io/tx/0x49005793174c338d139893f0d02169fa25edd19e695f82b963bf19d4fe8ae131) — **type 4 (EIP-7702)**, status success |
| UserOperation | `0x044a31082fe0721f5c840107561da6f28202c42727910cfeb1b4d64ae6eb8fe5` |
| Stealth address | [`0xA6F8F2A5…fEDf`](https://sepolia.etherscan.io/address/0xA6F8F2A5f6012d03e72F2E437D5a7058C477fEDf) — code `0xef0100e6cae83b…`, balance 0 |
| Gas paid by Paymaster | 0.00019934086342729 ETH |

Open the sweep transaction and check: the `authorizationList` has one entry delegating to `0xe6Cae83B…555B`, the bundler is `tx.from`, and **no transaction anywhere funds the stealth address from the recipient's wallet.**
