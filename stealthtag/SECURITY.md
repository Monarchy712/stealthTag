# StealthTag — Key Management Security Model

Scope: how the recipient's ERC-5564 spending and viewing keys are produced,
stored, and used. Implementation lives in `lib/keys.ts`, consumed via
`hooks/useStealthKeys.ts`.

This document describes what the code does today. It is not a claim of
production readiness, and it is not a privacy claim — see
["Privacy: what this does and does not give you"](#privacy-what-this-does-and-does-not-give-you).

---

## 1. What was replaced, and why

The earlier implementation derived both long-term keys directly from wallet
signatures over two public constant strings:

```
spendingPrivateKey = keccak256(sign("StealthTag: Generate Stealth Spending Key v1"))
viewingPrivateKey  = keccak256(sign("StealthTag: Generate Stealth Viewing Key v1"))
```

Problems:

| Issue | Consequence |
| --- | --- |
| Both messages are public constants | Any site that gets the user to sign those two strings reconstructs both private keys and can sweep every stealth address the user ever receives at |
| Signature was hashed once, not run through a KDF | No key-stretching, no extract/expand separation, no defined output namespace |
| No domain separation | Key roles were separated only by the message text; nothing bound the keys to an account, chain, or account index |
| No scalar validation | The hash was used as a secp256k1 private key without checking it lies in `[1, n)` |
| Both private keys written to `localStorage` | Any XSS, or anyone with the device, walks away with spending authority |

## 2. The current scheme

### 2.1 Inputs

Two independent secrets are both required:

1. **A wallet signature** over `buildKeyDerivationMessage(owner, chainId)` — an
   EIP-191 message bound to the KDF version, its purpose, the owner address,
   and the chain id. It is not secret; it proves control of the EOA and makes
   the derivation reproducible on any device.
2. **A passphrase** the user holds. It never appears in the signed message, is
   never transmitted, and is never written to storage by this module.

A signature harvested by a malicious dapp is therefore *not* sufficient to
derive the keys. That property is asserted by test group 10 in
`scripts/test-keys.ts`.

### 2.2 Master seed (HKDF-Extract)

```
ikm        = signatureBytes ‖ SHA-256("StealthTag-KDF-v1|passphrase|" ‖ passphrase)
salt       = SHA-256("StealthTag-KDF-v1|master-seed")
info       = "StealthTag-KDF-v1|master-seed|chain:<id>|owner:<addr>"
masterSeed = HKDF-SHA256(ikm, salt, info, 32 bytes)
```

The seed is zeroed (`masterSeed.fill(0)`) as soon as the two keys are expanded
from it.

### 2.3 Per-key expansion (HKDF-Expand) with domain separation

Each key is expanded from the master seed under its own `info` string:

```
info = "StealthTag-KDF-v1|secp256k1|scheme:1|<domain>|chain:<id>|owner:<addr>|index:<n>|ctr:<c>"
       where <domain> ∈ { spending, viewing }
```

The `info` string is the domain separator. HKDF guarantees that distinct `info`
values yield independent outputs from the same seed, so the spending and viewing
namespaces cannot collide, and keys are additionally bound to the owner address,
the chain id, and an account index (so one seed can back several meta-addresses).

`ctr` implements **rejection sampling**: a candidate 32-byte block is accepted
only if it is a valid secp256k1 scalar (`0 < k < n`). Otherwise `ctr` is
incremented and the block re-expanded. This keeps the output uniform over the
group order — unlike reducing a hash mod `n`, which is very slightly biased —
while keeping derivation deterministic.

### 2.4 Determinism boundary

Deterministic **by design**, because stealth keys must be recoverable without a
backup file: the same `{signature, passphrase, owner, chainId, index}` always
produces the same keys.

Non-deterministic where it must be: `generateRandomMasterSeed()` uses
`crypto.getRandomValues` for users who prefer to back up a seed, and the
*ephemeral* keys used per payment are generated randomly inside the ScopeLift
SDK, never by this module.

### 2.5 Storage

- **Persisted (`localStorage`)**: meta-address, both *public* keys, owner
  address, chain id, account index. Public data only.
- **Session memory only**: the spending and viewing *private* keys, in a
  module-level store shared across pages. Dropped on reload or on "Lock keys",
  after which the user re-derives from signature + passphrase.

### 2.6 Compatibility

Nothing here changes ERC-5564. The output is two ordinary secp256k1 scalars and
their compressed public keys; the meta-address bytes are assembled by the SDK's
`generateStealthMetaAddressFromKeys`. All elliptic-curve work — ECDH, shared
secret, view tag, stealth address, `computeStealthKey` — remains in
`@scopelift/stealth-address-sdk`. No custom stealth-address scheme is
introduced.

---

## 3. Properties this gives you

| Property | How |
| --- | --- |
| A public fixed-message signature is insufficient | Passphrase is a required, independent input and is absent from the signed message |
| Spending and viewing keys are independent | Separate HKDF `info` strings over a shared seed |
| Keys are bound to account, chain, and index | All three appear in the `info` string; a signature cannot be replayed into another context |
| Uniform, valid private keys | Rejection sampling against the curve order |
| Recoverable without a backup file | Deterministic in `{signature, passphrase, owner, chain, index}` |
| Private keys are not persisted | Only the public half reaches `localStorage` |
| Versioned | `KDF_VERSION` tags every derivation; bumping it is an explicit migration |

## 4. Residual risks — not mitigated

1. **Passphrase strength and loss.** The passphrase is half the key material and
   is used directly (HKDF, not a memory-hard KDF). A weak passphrase is
   brute-forceable by anyone who also holds the signature. Losing it loses the
   funds. A memory-hard KDF (Argon2id/scrypt) over the passphrase before mixing
   is the right hardening step and is **not implemented**.
2. **Browser memory custody.** While unlocked, the private keys sit in JS memory
   in the tab. XSS in the app reads them. Hardware-backed or MPC custody is the
   production answer; neither is implemented.
3. **`localStorage` metadata.** The stored public bundle links the browser
   profile to the meta-address. Nothing spendable, but it is a local
   correlation artifact.
4. **The wallet sees the signed message.** A wallet or extension logs that this
   user derives StealthTag keys. It does not learn the passphrase.
5. **No key rotation or revocation.** Rotating means deriving under a new index
   or version and re-registering in ERC-6538; the old meta-address stays
   published and payments to it stay detectable with the old viewing key.
6. **No encrypted export/backup format.**

---

## Privacy: what this does and does not give you

Key management is not privacy. Keeping the boundaries explicit:

- **Stealth addresses (ERC-5564)** provide *unlinkability* between payments:
  each payment lands at a fresh address, and an observer cannot group them or
  total them from the announcements alone.
- **A Paymaster** solves *gas sponsorship* — letting a stealth address transact
  without first being funded from a known wallet. **It does not provide
  privacy.** A Paymaster the user pays for directly, or one used by only this
  user, reintroduces the correlation it was meant to avoid.
- **A relayer** can reduce *network/RPC correlation* between the user's IP and
  the stealth address's transactions.

**Not implemented in this repository:** the relaying/funding architecture. There
is no relayer, and the Paymaster path in `lib/smartAccount.ts` has not been
analyzed for correlation. Do not read this document as a claim that the funding
path is privacy-preserving.

### Still observable today

1. Transfer amounts — an unusual amount in and the same amount out links a
   stealth address to its sweep destination.
2. ERC-6538 registration — publicly links an EOA to a meta-address.
3. ERC-5564 announcements — public; anyone can see that *a* stealth payment
   happened, and who announced it.
4. Network/RPC metadata — the RPC provider sees which addresses a client asks
   about, which can link a viewing-key holder to the addresses they scan.

Nothing in this milestone changed the on-chain footprint, so no new correlation
risk was introduced by it.

---

## Verification

```bash
npm run test        # Milestone 2 key-management suite + Milestone 1 ERC-5564 suite
npm run typecheck
npm run build
```

`scripts/test-keys.ts` covers determinism, key distinctness, domain separation
(across domain, owner, chain, and index), stable derivation vectors, secp256k1
validity of every derived key, end-to-end ERC-5564 Scheme 1 detection with
KDF-derived keys, the `privateKeyToAddress(stealthPrivateKey) ===
announcement.stealthAddress` correctness gate, rejection of unrelated
announcements, and the "signature alone is insufficient" property.
