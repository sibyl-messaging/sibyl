import { CipherSuite, ExportOnly, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import {
  base64ToBytes,
  bytesToBase64,
  deriveStampShare,
  encodeStampShareContext,
  stampHelperStatusSchema,
  utf8ToBytes,
  type StampHelperStatus,
  type StampShare
} from "@sibyl/protocol";

const EXPORTER_CONTEXT = utf8ToBytes("sibyl/stamp-exporter/v2");
const EXPORTER_SECRET_BYTES = 32;

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new ExportOnly()
});

export interface InitiatorStampResult {
  stamp: StampShare;
  hpkeEncapsulation: string;
}

export class HelperCryptoSession {
  private keyPair: CryptoKeyPair | null;

  private constructor(keyPair: CryptoKeyPair) {
    this.keyPair = keyPair;
  }

  static async create(): Promise<HelperCryptoSession> {
    return new HelperCryptoSession(await suite.kem.generateKeyPair());
  }

  async publicKeyBase64(): Promise<string> {
    const keyPair = this.requireKeyPair();
    return bytesToBase64(
      new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey))
    );
  }

  async deriveAsInitiator(rawStatus: StampHelperStatus): Promise<InitiatorStampResult> {
    const status = requirePairedStatus(rawStatus, "initiator");
    if (!status.peerHpkePublicKey) {
      throw new Error("The other helper is not ready yet");
    }
    const recipientPublicKey = await suite.kem.deserializePublicKey(
      base64ToBytes(status.peerHpkePublicKey)
    );
    const info = await hpkeInfo(status);
    const sender = await suite.createSenderContext({ recipientPublicKey, info });
    const exporterSecret = new Uint8Array(
      await sender.export(EXPORTER_CONTEXT, EXPORTER_SECRET_BYTES)
    );
    try {
      return {
        stamp: deriveStampShare(exporterSecret, status.shareContext),
        hpkeEncapsulation: bytesToBase64(new Uint8Array(sender.enc))
      };
    } finally {
      exporterSecret.fill(0);
      info.fill(0);
    }
  }

  async deriveAsRecipient(rawStatus: StampHelperStatus): Promise<StampShare> {
    const status = requirePairedStatus(rawStatus, "recipient");
    if (!status.hpkeEncapsulation) {
      throw new Error("The other helper is not ready yet");
    }
    const keyPair = this.requireKeyPair();
    const info = await hpkeInfo(status);
    const encapsulation = base64ToBytes(status.hpkeEncapsulation);
    const recipient = await suite.createRecipientContext({
      recipientKey: keyPair.privateKey,
      enc: encapsulation,
      info
    });
    const exporterSecret = new Uint8Array(
      await recipient.export(EXPORTER_CONTEXT, EXPORTER_SECRET_BYTES)
    );
    try {
      return deriveStampShare(exporterSecret, status.shareContext);
    } finally {
      exporterSecret.fill(0);
      encapsulation.fill(0);
      info.fill(0);
    }
  }

  destroy(): void {
    // WebCrypto CryptoKeys cannot be overwritten. Dropping the only reference
    // is the strongest browser primitive available; all byte-array secrets are
    // explicitly zeroed immediately after derivation.
    this.keyPair = null;
  }

  private requireKeyPair(): CryptoKeyPair {
    if (!this.keyPair) {
      throw new Error("This helper session has ended");
    }
    return this.keyPair;
  }
}

async function hpkeInfo(status: PairedStatus): Promise<Uint8Array> {
  const contextBytes = encodeStampShareContext(status.shareContext);
  try {
    const digestInput = new Uint8Array(contextBytes).buffer;
    return new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
  } finally {
    contextBytes.fill(0);
  }
}

type PairedStatus = StampHelperStatus & {
  pairId: string;
  bundleId: string;
  shareIndex: number;
  role: StampHelperStatus["role"] & string;
  shareContext: NonNullable<StampHelperStatus["shareContext"]>;
};

function requirePairedStatus(
  rawStatus: StampHelperStatus,
  expectedRole: "initiator" | "recipient"
): PairedStatus {
  const status = stampHelperStatusSchema.parse(rawStatus);
  if (
    status.state === "waiting_for_scan" ||
    status.state === "waiting_for_partner" ||
    !status.pairId ||
    !status.bundleId ||
    status.shareIndex === null ||
    !status.shareContext ||
    status.role !== expectedRole
  ) {
    throw new Error("The helper pair is not ready");
  }
  return status as PairedStatus;
}
