// ===========================================================
// Shared TypeScript types for StealthTag
// ===========================================================

/** A stealth meta-address (the "handle" you publish publicly).
 *  Encodes both the spending public key and the viewing public key.
 *  Format: st:eth:0x<33-byte-spending-pubkey><33-byte-viewing-pubkey>
 *  (ERC-5564 Scheme 1 uses COMPRESSED secp256k1 public keys.)
 */
export interface StealthMetaAddress {
  /** The full ERC-5564 encoded meta-address string */
  metaAddress: string;
  /** Spending public key (hex, COMPRESSED 33 bytes: 02.../03...) */
  spendingPublicKey: `0x${string}`;
  /** Viewing public key (hex, COMPRESSED 33 bytes: 02.../03...) */
  viewingPublicKey: `0x${string}`;
}

/** The local key bundle stored by the recipient.
 *  The spending key and viewing key are derived via domain-separated HKDF
 *  from a master seed (wallet signature + user passphrase). See lib/keys.ts.
 *  NEVER expose these to the network.
 */
export interface StealthKeyBundle {
  /** Spending private key (hex) */
  spendingPrivateKey: `0x${string}`;
  /** Spending public key (hex) */
  spendingPublicKey: `0x${string}`;
  /** Viewing private key (hex) */
  viewingPrivateKey: `0x${string}`;
  /** Viewing public key (hex) */
  viewingPublicKey: `0x${string}`;
  /** Full meta-address string */
  metaAddress: string;
  /** The EOA address these keys were derived for */
  ownerAddress: `0x${string}`;
  /** Chain the keys were bound to during derivation (KDF domain separation) */
  chainId?: number;
  /** Account index within the master seed (KDF domain separation) */
  accountIndex?: number;
}

/** A stealth address derived for a single payment (sender side) */
export interface DerivedStealthAddress {
  /** The one-time stealth address (recipient of funds) */
  stealthAddress: `0x${string}`;
  /** Ephemeral public key published in the announcement */
  ephemeralPublicKey: `0x${string}`;
  /** View tag for cheap pre-filtering */
  viewTag: `0x${string}` | string;
}

/** A raw announcement event from the ERC-5564 Announcer */
export interface AnnouncementEvent {
  /** Scheme ID — 1 for secp256k1 with view tags */
  schemeId: bigint;
  /** The stealth address that received the payment */
  stealthAddress: `0x${string}`;
  /** Ephemeral public key published by sender */
  ephemeralPubKey: `0x${string}`;
  /** ERC-5564 metadata field — the view tag is byte 0 */
  metadata: `0x${string}`;
  /** Block number of the announcement */
  blockNumber: bigint;
  /** Transaction hash of the announcement */
  transactionHash: `0x${string}`;
  /** The sender / caller of the announce function */
  caller: `0x${string}`;
}

/** A detected payment (announcement confirmed belonging to recipient) */
export interface DetectedPayment {
  /** The one-time stealth address holding the funds */
  stealthAddress: `0x${string}`;
  /** The stealth private key (spending key for this address) */
  stealthPrivateKey: `0x${string}`;
  /** Ephemeral public key from announcement */
  ephemeralPublicKey: `0x${string}`;
  /** Block number when announced */
  blockNumber: bigint;
  /** Transaction hash of announcement */
  transactionHash: `0x${string}`;
  /** ETH balance at the stealth address (fetched separately) */
  balance?: bigint;
  /** Has this payment been swept already? */
  swept: boolean;
  /** Sweep tx hash (if swept) */
  sweepTxHash?: `0x${string}`;
}

/** Status of an ongoing transaction or operation */
export type TxStatus =
  | 'idle'
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'simulated'; // Demo mode only

export interface TxState {
  status: TxStatus;
  hash?: `0x${string}`;
  error?: string;
  /** True if this was a simulated (demo mode) transaction */
  isSimulated?: boolean;
}

/** Smart account info */
export interface SmartAccountInfo {
  /** Smart account address (NOT the EOA, NOT the meta-address) */
  address: `0x${string}`;
  /** Whether the smart account is deployed on-chain yet */
  isDeployed: boolean;
}

/** App-wide demo mode state */
export interface DemoPayment {
  stealthAddress: `0x${string}`;
  amount: string; // in ETH string form
  senderLabel: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  ephemeralPublicKey: `0x${string}`;
}
