# StealthTag — Privacy & Correlation Analysis

What this system does and does not hide, actor by actor. Written to be
falsifiable rather than reassuring. Key management is covered separately in
[`SECURITY.md`](./SECURITY.md).

**StealthTag does not provide anonymity.** It provides *unlinkability between
payments*, plus two narrow operational improvements. Everything below is
scoped to that claim.

---

## 1. Four different things, deliberately kept apart

| Mechanism | What it actually provides | What it does NOT provide |
| --- | --- | --- |
| **Stealth addresses (ERC-5564)** | Unlinkability *between payments*. Each payment lands at a fresh address; an observer cannot group them or total them from announcements alone. | Anonymity. Anything about where funds go afterwards. |
| **Paymaster (ERC-4337)** | Gas sponsorship, so a stealth address never needs a gas top-up from a known wallet. | Privacy. The Paymaster records every operation it sponsors. |
| **Relay** | Network privacy from *upstream providers*: Pimlico and the RPC node see the relay, not the user's IP. | Anonymity. The relay operator sees everything the upstream used to. |
| **EIP-7702** | Executability: the stealth EOA can itself be the ERC-4337 sender, with no migration transfer. | Any privacy property whatsoever. It is a plumbing fix. |

A Paymaster alone does **not** make a system privacy-preserving. Neither does a
relay. They solve gas and network metadata respectively; the on-chain graph is
untouched by both.

---

## 2. The stealth address is an EOA — and why that mattered

ERC-5564 Scheme 1 produces `publicKeyToAddress(stealthPubKey)`: **a plain EOA**,
controlled by the stealth private key that `computeStealthKey` reconstructs. It
is *not* a smart-account address and *not* an EOA that owns one.

The previous implementation built a Kernel v3 account **owned by** the stealth
key. That account lives at a different address:

```
stealth EOA        0x556a…0587   ← the ETH is here
Kernel v3 account  0xeAF1…Fbd5   ← the UserOperation came from here (0 wei)
```

so every sweep failed. Moving funds into that account first would require a
transaction *from the EOA* — the original problem, unsolved, plus an extra
on-chain hop.

**EIP-7702 removes the mismatch instead of working around it.** The stealth EOA
signs an authorization delegating its code to `Simple7702Account`
(`0xe6Cae…555B`, verified deployed on Sepolia). Under EIP-7702 the account
address *is* the EOA address, so the ERC-5564 receiving address and the
ERC-4337 `sender` are the same address.

**No migration or forwarding step is required, so no privacy property is
destroyed to gain executability.** Signing the authorization and the
UserOperation are both free; neither touches the chain until someone else
submits them.

Verified end-to-end on a Sepolia fork — see `scripts/test-sweep-local.ts`.

---

## 3. Funding the first transaction — the options

The stealth address holds ETH but has never transacted. Something must pay for
the first operation.

### A. Paymaster-sponsored UserOperation *(implemented, default)*

- **Who pays:** the Paymaster, from its EntryPoint deposit.
- **Funds come from:** the dapp operator's prepaid Pimlico balance.
- **On-chain:** `EntryPoint.handleOps` with `paymasterAndData` set. The
  Paymaster address is public and appears in **every** operation it sponsors.
- **Relay knows:** the stealth address, destination, amount, timing, user IP.
- **Paymaster knows:** the stealth address, destination, amount, timing, and
  the API key — which groups all sweeps by this dapp, and with per-request
  logging can group all sweeps by this *user*.
- **Known wallet linked:** **no.**
- **Risks:** all sponsored sweeps share one Paymaster address on-chain, so the
  set of StealthTag users is publicly enumerable, and a Paymaster that logs can
  reconstruct the whole mapping off-chain. Sponsorship policies (rate limits,
  allowlists) can leak further.
- **Complexity:** low. Existing Pimlico infrastructure.

### B. Relayer-sponsored transaction

- **Who pays:** the relayer's own EOA.
- **On-chain:** the relayer address appears as `tx.origin` for every sweep it
  submits — the same enumerability problem as (A), with the relayer instead of
  the Paymaster.
- **Known wallet linked:** no.
- **Risks:** a relayer that both submits *and* pays is a single point that sees
  and signs everything. It also needs a funded hot wallet.
- **Complexity:** medium (key management, refills, nonce handling).
- **Verdict:** strictly worse than (A) here — same correlation, more moving
  parts. Not implemented.

### C. Separate gas tank / service wallet

- **Who pays:** a service wallet that pre-funds stealth addresses.
- **On-chain:** a transfer **into** the stealth address before the sweep. This
  reintroduces exactly the inbound funding edge the design exists to avoid,
  merely moving its origin from the user's wallet to a service wallet — and
  the service wallet's outgoing transfers enumerate every stealth address in
  the system.
- **Known wallet linked:** not directly, but the gas-tank address becomes a
  public index of all StealthTag stealth addresses.
- **Verdict:** **rejected.** Strictly the worst option on-chain.

### D. Self-funded gas via EIP-7702 *(implemented, `gasMode: 'self-funded'`)*

- **Who pays:** the stealth address itself, out of the ETH it already received.
- **On-chain:** an ordinary sponsored-less `handleOps`. **No Paymaster address,
  no gas-tank transfer, no third-party payer appears at all.**
- **Relay knows:** the same as (A) — it still submits.
- **Paymaster knows:** *nothing. There is no Paymaster.*
- **Known wallet linked:** **no.**
- **Risks:** requires the payment to exceed gas cost, so it does not work for
  ERC-20-only payments or dust. The EntryPoint refunds unused prefund to the
  account's *deposit*, not its balance, leaving a small residue at the stealth
  address (measured: ~0.0009 ETH in the local test) — a lingering artifact that
  a later sweep would re-touch.
- **Complexity:** lowest of all. Fewer parties than (A).

### Choice

Both (A) and (D) are implemented; (D) is **less** correlated because it removes
an entire observer. The honest summary is that neither is dramatically better
than the other for a hackathon: (D) wins on correlation, (A) wins on
completeness (ERC-20, dust, zero residue).

This is deliberately *not* a novel privacy protocol. A mixer, a shielded pool,
or a decentralised relayer network would each add far more machinery than the
required property — "no funding edge from the known wallet" — actually needs.
EIP-7702 supplies that property directly.

---

## 4. Lifecycle of the first transaction

```
1. Payment arrives      Sender's wallet → stealth EOA (an ordinary transfer).
                        Sender also calls Announcer.announce(...).

2. Balance              Stealth EOA holds X ETH, has no code, has never
                        transacted. It cannot pay for anything by itself yet.

3. Initiated by         The recipient's browser, after detecting the payment
                        with the viewing key and reconstructing the stealth
                        private key with the spending key.

4. Signed by            The stealth private key, twice, both in the browser:
                          (a) an EIP-7702 authorization → Simple7702Account
                          (b) the UserOperation
                        Neither signature costs gas. No key leaves the browser.

5. Submitted by         The relay (server-side) → Pimlico bundler → EntryPoint
                        v0.8. The bundler's EOA is tx.origin on-chain.

6. Gas paid by          'sponsored': the Paymaster's EntryPoint deposit.
                        'self-funded': the stealth address's own received ETH.

7. Paymaster repaid by  The dapp operator's prepaid Pimlico balance. In
                        self-funded mode this step does not exist.

8. Remaining ETH        Goes to the destination the user typed. Sponsored mode
                        sweeps 100%. Self-funded leaves the unused prefund in
                        the EntryPoint deposit plus a small balance residue.

9. Observer sees        A handleOps transaction from the bundler; a UserOp whose
                        sender is the stealth address; a transfer
                        stealthAddress → destination for the exact amount; the
                        stealth address gaining 7702 delegation code; and, in
                        sponsored mode, the Paymaster address.

10. Relay sees          Everything in the request: the user's IP, the stealth
                        addresses scanned, the UserOp, its destination, its
                        amount, and the timing. NOT any private key.

11. Paymaster sees      The UserOperation it is asked to sponsor: sender,
                        destination, amount, timing, and the relay's IP —
                        never the user's. Nothing in self-funded mode.
```

---

## 5. Correlation table

| Actor | Can see | Can link to user? | Can link payments? | Risk | Mitigation |
| --- | --- | --- | --- | --- | --- |
| **Blockchain observer** | Announcements; stealth addresses; the funding tx from the sender; the sweep `stealthAddress → destination` with exact amounts; 7702 delegation code; the Paymaster address in sponsored mode | **Yes, if the destination is a known address** — that single edge does it. Also yes via the ERC-6538 registration, which publicly maps EOA → meta-address | **Yes, by destination**: several stealth addresses paying one address are obviously one recipient. Also by **amount** and by **timing** | **Highest risk in the system** | Sweep to a destination not tied to your identity; vary timing; avoid round/unique amounts. The UI now requires an explicit destination and warns when it is the connected wallet. **Not fully mitigated** |
| **Sender** | The recipient's meta-address, the stealth address they derived, the amount, and the ephemeral key they generated | Yes — they chose to pay this identity | Only their own payments. Cannot see other senders' payments to the same handle | Low; inherent | None needed. This is by design |
| **Recipient** | Everything of theirs | — | — | — | — |
| **Recipient's known wallet** | Signs the ERC-6538 registration and the key-derivation message | **Yes — the ERC-6538 registration is a public EOA → meta-address link** | Not by itself | Medium. Registration is optional but is how discovery works | Skip registration and share the meta-address out-of-band; or register from an address that is not your main wallet. **Not mitigated by default** |
| **Relayer** (this app's `/api/relay`) | User IP; every stealth address scanned; the signed UserOp, its destination, amount, timing | **Yes** — it sees the IP and the addresses together | **Yes** — trivially, all of one user's payments | **High. This is a trust boundary, not an anonymiser** | Method allowlist; no key material ever sent; cannot alter a signed UserOp without invalidating it. **Trust is moved, not removed.** A self-hosted relay, Tor, or a VPN changes who you trust |
| **Bundler** (Pimlico) | The UserOp and the relay's IP | Not directly — it sees the relay | Yes, by API key: all StealthTag sweeps group together | Medium | Relay hides user IP. Grouping by API key is **not** mitigated |
| **Paymaster** (Pimlico) | Every sponsored UserOp: sender, destination, amount, timing; the relay's IP | Not directly | Yes — a sponsor sees its whole sponsored set | Medium | Use `gasMode: 'self-funded'` to remove this observer entirely. Otherwise **not mitigated** |
| **RPC provider** | Which addresses are queried and when | Not directly — it sees the relay | Would otherwise be severe: the set of addresses one client asks balances for **is** the set of payments for one viewing key | Medium | All scanning routed through the relay. **The relay operator inherits this exact visibility** |

### Specific channels

- **IP correlation.** Before: the browser called Pimlico and a public RPC
  directly, so both could join the user's IP to their stealth addresses. Now
  both see only the relay. The relay operator sees it instead.
- **RPC metadata.** Scanning is a fingerprint: the queried address set *is* the
  payment set. Routed through the relay. Full mitigation needs client-side
  filtering over bulk-downloaded announcements, or private information
  retrieval. **Not implemented.**
- **Timing correlation.** A payment announced at T and swept at T+30s links the
  two even without amounts. **Not mitigated** — no delay or batching.
- **Transaction amount correlation.** X ETH in, X-minus-dust out is a direct
  link. Sponsored mode sweeps the *exact* balance, which is a perfect match.
  **Not mitigated** — no splitting, no partial sweeps.
- **Gas sponsorship correlation.** In sponsored mode the Paymaster address is
  on-chain in every sweep, so StealthTag sweeps are publicly enumerable as a
  set. Self-funded mode removes this. **Partially mitigable, by user choice.**
- **UserOperation visibility.** UserOps sit in a public alt-mempool before
  inclusion; anyone running a bundler can observe them early. **Not mitigated.**
- **Paymaster visibility.** See the table. Removable only by not using one.
- **Destination-wallet correlation.** The dominant risk. The UI no longer
  defaults to the connected wallet and warns explicitly, but a user who sweeps
  to a known address undoes everything upstream of it.
- **ERC-6538 registration linkage.** Public, permanent, and by design: it maps
  a real EOA to a meta-address. Anyone who later links a stealth address to
  that meta-address links it to that EOA.

---

## 6. What is actually achieved

**Achieved**

1. Payments to one handle are unlinkable *from announcements alone*.
2. A stealth address never needs ETH from the recipient's known wallet — there
   is **no inbound funding edge**, verified end-to-end locally.
3. The ERC-5564 receiving address and the ERC-4337 sender are the same address,
   so no migration hop exists to correlate.
4. Pimlico and the RPC provider no longer see the user's IP.
5. The Pimlico API key is no longer shipped to every visitor's browser.
6. Self-funded mode can remove the Paymaster as an observer entirely.

**Not achieved**

1. Anonymity. Not claimed anywhere.
2. Resistance to destination correlation — the largest remaining hole.
3. Resistance to amount or timing correlation.
4. Privacy *from the relay operator*.
5. Unlinkability of the ERC-6538 registration.
6. Sender-side privacy: the funding tx and the announcement both come from the
   sender's public wallet, which is visible as the announcement `caller`.

---

## 7. Honest status of the relay

The relay is a **server-side JSON-RPC proxy**, not an anonymity network. It is
a real privacy boundary in one specific sense — it terminates the user's
network identity before it reaches third-party infrastructure — and it is a
real security boundary for the API key. It is not a mixnet, it does not batch
or delay, it does not blind what it forwards, and it does not remove trust: it
relocates it from Pimlico and the RPC provider to whoever runs the relay.

A user who does not trust the relay operator should self-host it. That is a
supported deployment: it is a single Next.js route with two env vars.
