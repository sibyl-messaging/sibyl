import { createHash } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519";
import {
  signStampCiphertextMessage,
  stampHelperQrPayloadSchema,
  type SignedStampCiphertextMessage,
  type StampBundleDescriptor,
  type StampHelperRole,
  type StampHelperSlot,
  type StampHelperStatus
} from "@sibyl/protocol";
import { describe, expect, it } from "vitest";

import type {
  CreateStampBundleRecord,
  CreateStampHelperClaimRecord,
  RegisterStampHelperRecord,
  StampRelayRepository,
  StoredStampHelperClaim
} from "../src/services/stampRepository.js";
import { StampService } from "../src/services/stampService.js";
import type { AuthContext } from "../src/types/domain.js";

const NOW_MS = 1_750_000_000_000;
const ALICE_AUTH: AuthContext = {
  userId: "alice",
  username: "alice",
  deviceId: "alice_device"
};

interface MemoryRegistration extends RegisterStampHelperRecord {
  attached: boolean;
}

interface MemorySide {
  role: StampHelperRole;
  registrationId: string | null;
  confirmed: boolean;
}

interface MemoryPair {
  pairId: string;
  bundleId: string;
  shareIndex: number;
  state: "waiting" | "paired" | "confirmed";
  hpkeEncapsulation: string | null;
  sides: Record<StampHelperRole, MemorySide>;
}

interface MemoryClaim {
  claimId: string;
  registrationId: string;
  pairId: string;
  bundleId: string;
  shareIndex: number;
  role: StampHelperRole;
  userId: string;
  linkCodeHash: string;
  expiresAtMs: number;
  approved: boolean;
}

class MemoryStampRepository implements StampRelayRepository {
  readonly bundles = new Map<string, StampBundleDescriptor>();
  readonly records: CreateStampBundleRecord[] = [];
  readonly registrations = new Map<string, MemoryRegistration>();
  readonly claims = new Map<string, MemoryClaim>();
  readonly pairs = new Map<string, MemoryPair>();
  readonly messages = new Map<string, SignedStampCiphertextMessage>();
  readonly acknowledged = new Set<string>();

  constructor(private readonly nowMs: number) {}

  async createBundle(input: CreateStampBundleRecord): Promise<StampBundleDescriptor> {
    this.records.push(structuredClone(input));
    const descriptor: StampBundleDescriptor = {
      version: 2,
      sessionId: input.sessionId,
      bundleId: input.bundleId,
      initiatorUserId: input.initiatorUserId,
      recipientUserId: input.recipientUserId,
      shareCount: input.shareCount,
      bundleSequence: 0,
      createdAtMs: this.nowMs,
      state: "proposed"
    };
    this.bundles.set(input.bundleId, descriptor);
    for (const pair of input.pairs) {
      this.pairs.set(pair.pairId, {
        pairId: pair.pairId,
        bundleId: input.bundleId,
        shareIndex: pair.shareIndex,
        state: "waiting",
        hpkeEncapsulation: null,
        sides: {
          initiator: { role: "initiator", registrationId: null, confirmed: false },
          recipient: { role: "recipient", registrationId: null, confirmed: false }
        }
      });
    }
    return descriptor;
  }

  async getBundleForUser(bundleId: string, userId: string): Promise<StampBundleDescriptor | null> {
    const bundle = this.bundles.get(bundleId);
    return bundle &&
      (bundle.initiatorUserId === userId || bundle.recipientUserId === userId)
      ? bundle
      : null;
  }

  async getBundleById(bundleId: string): Promise<StampBundleDescriptor | null> {
    return this.bundles.get(bundleId) ?? null;
  }

  async getLatestBundleForConversationAndUser(
    conversationId: string,
    userId: string,
    nowMs: number
  ): Promise<StampBundleDescriptor | null> {
    const record = [...this.records]
      .reverse()
      .find(
        (item) =>
          item.conversationId === conversationId &&
          (item.initiatorUserId === userId || item.recipientUserId === userId) &&
          item.expiresAtMs > nowMs
      );
    return record ? this.bundles.get(record.bundleId) ?? null : null;
  }

  async getHelperSlots(
    bundleId: string,
    role: StampHelperRole
  ): Promise<StampHelperSlot[]> {
    return [...this.pairs.values()]
      .filter((pair) => pair.bundleId === bundleId)
      .sort((a, b) => a.shareIndex - b.shareIndex)
      .map((pair) => this.slot(pair, role));
  }

  async getCompletedShareIndexes(
    bundleId: string,
    role: StampHelperRole
  ): Promise<number[]> {
    return [...this.pairs.values()]
      .filter(
        (pair) => pair.bundleId === bundleId && pair.sides[role].confirmed
      )
      .map((pair) => pair.shareIndex)
      .sort((a, b) => a - b);
  }

  async registerHelper(input: RegisterStampHelperRecord): Promise<void> {
    this.registrations.set(input.registrationId, { ...input, attached: false });
  }

  async createAttachmentClaim(
    input: CreateStampHelperClaimRecord
  ): Promise<StoredStampHelperClaim | null> {
    const pair = this.pairs.get(input.pairId);
    const bundle = this.bundles.get(input.bundleId);
    const registration = this.registrations.get(input.registrationId);
    if (
      !pair || !bundle || pair.bundleId !== bundle.bundleId || !registration ||
      registration.expiresAtMs <= input.nowMs || registration.attached ||
      this.expiresAt(bundle.bundleId) <= input.nowMs
    ) {
      return null;
    }
    const role = bundle.initiatorUserId === input.userId
      ? "initiator"
      : bundle.recipientUserId === input.userId
        ? "recipient"
        : null;
    if (!role || pair.sides[role].registrationId) {
      return null;
    }
    if (
      [...this.claims.values()].some(
        (claim) =>
          claim.registrationId === registration.registrationId &&
          claim.linkCodeHash === input.linkCodeHash
      )
    ) {
      return null;
    }
    const claim: MemoryClaim = {
      claimId: input.claimId,
      registrationId: input.registrationId,
      pairId: input.pairId,
      bundleId: input.bundleId,
      shareIndex: pair.shareIndex,
      role,
      userId: input.userId,
      linkCodeHash: input.linkCodeHash,
      expiresAtMs: Math.min(registration.expiresAtMs, this.expiresAt(bundle.bundleId)),
      approved: false
    };
    this.claims.set(claim.claimId, claim);
    return this.storedClaim(claim, input.nowMs);
  }

  async getAttachmentClaim(
    claimId: string,
    userId: string,
    nowMs: number
  ): Promise<StoredStampHelperClaim | null> {
    const claim = this.claims.get(claimId);
    return claim && claim.userId === userId ? this.storedClaim(claim, nowMs) : null;
  }

  async approveAttachmentClaim(
    tokenHash: string,
    linkCodeHash: string,
    nowMs: number
  ): Promise<StampHelperStatus | null> {
    const access = this.findRegistration(tokenHash);
    if (!access || access.registration.attached) return null;
    const claim = [...this.claims.values()].find(
      (item) =>
        item.registrationId === access.registration.registrationId &&
        item.linkCodeHash === linkCodeHash &&
        !item.approved &&
        item.expiresAtMs > nowMs
    );
    if (!claim) return null;
    const pair = this.pairs.get(claim.pairId)!;
    if (pair.sides[claim.role].registrationId) return null;
    pair.sides[claim.role].registrationId = access.registration.registrationId;
    access.registration.attached = true;
    claim.approved = true;
    if (pair.sides.initiator.registrationId && pair.sides.recipient.registrationId) {
      pair.state = "paired";
    }
    const bundle = this.bundles.get(pair.bundleId)!;
    if (bundle.state === "proposed") {
      this.bundles.set(bundle.bundleId, { ...bundle, state: "pairing" });
    }
    return this.status(access.registration, pair, pair.sides[claim.role]);
  }

  async getHelperStatus(tokenHash: string, nowMs: number): Promise<StampHelperStatus | null> {
    const access = this.findRegistration(tokenHash);
    if (!access || access.registration.expiresAtMs <= nowMs) {
      return null;
    }
    return this.status(access.registration, access.pair, access.side);
  }

  async publishHpkeEncapsulation(
    tokenHash: string,
    hpkeEncapsulation: string,
    nowMs: number
  ): Promise<StampHelperStatus | null> {
    const access = this.findRegistration(tokenHash);
    if (
      !access?.pair || !access.side || access.side.role !== "initiator" ||
      access.pair.state !== "paired" || access.registration.expiresAtMs <= nowMs ||
      (access.pair.hpkeEncapsulation !== null &&
        access.pair.hpkeEncapsulation !== hpkeEncapsulation)
    ) {
      return null;
    }
    access.pair.hpkeEncapsulation = hpkeEncapsulation;
    return this.status(access.registration, access.pair, access.side);
  }

  async confirmHelper(tokenHash: string, nowMs: number): Promise<StampHelperStatus | null> {
    const access = this.findRegistration(tokenHash);
    if (
      !access?.pair || !access.side || access.pair.state === "waiting" ||
      !access.pair.hpkeEncapsulation || access.registration.expiresAtMs <= nowMs
    ) {
      return null;
    }
    access.side.confirmed = true;
    if (access.pair.sides.initiator.confirmed && access.pair.sides.recipient.confirmed) {
      access.pair.state = "confirmed";
    }
    const bundle = this.bundles.get(access.pair.bundleId)!;
    const bundlePairs = [...this.pairs.values()].filter(
      (pair) => pair.bundleId === bundle.bundleId
    );
    if (bundlePairs.every((pair) => pair.state === "confirmed")) {
      this.bundles.set(bundle.bundleId, { ...bundle, state: "ready" });
    }
    return this.status(access.registration, access.pair, access.side);
  }

  async consumeBundleAndStoreMessage(
    message: SignedStampCiphertextMessage,
    nowMs: number
  ): Promise<boolean> {
    const bundle = this.bundles.get(message.bundleId);
    if (
      !bundle || bundle.state !== "ready" ||
      bundle.initiatorUserId !== message.senderUserId ||
      bundle.recipientUserId !== message.recipientUserId ||
      nowMs >= this.expiresAt(bundle.bundleId)
    ) {
      return false;
    }
    this.bundles.set(bundle.bundleId, { ...bundle, state: "consumed" });
    this.messages.set(message.messageId, message);
    return true;
  }

  async getPendingMessages(userId: string): Promise<SignedStampCiphertextMessage[]> {
    return [...this.messages.values()].filter(
      (message) => message.recipientUserId === userId && !this.acknowledged.has(message.messageId)
    );
  }

  async acknowledgeMessage(messageId: string, userId: string): Promise<boolean> {
    const message = this.messages.get(messageId);
    if (!message || message.recipientUserId !== userId) {
      return false;
    }
    this.acknowledged.add(messageId);
    return true;
  }

  private findRegistration(tokenHash: string): {
    registration: MemoryRegistration;
    pair: MemoryPair | null;
    side: MemorySide | null;
  } | null {
    const registration = [...this.registrations.values()].find(
      (item) => item.accessTokenHash === tokenHash
    );
    if (!registration) return null;
    for (const pair of this.pairs.values()) {
      for (const side of Object.values(pair.sides)) {
        if (side.registrationId === registration.registrationId) {
          return { registration, pair, side };
        }
      }
    }
    return { registration, pair: null, side: null };
  }

  private status(
    registration: MemoryRegistration,
    pair: MemoryPair | null,
    side: MemorySide | null
  ): StampHelperStatus {
    if (!pair || !side) {
      const hasPendingClaim = [...this.claims.values()].some(
        (claim) =>
          claim.registrationId === registration.registrationId &&
          !claim.approved &&
          claim.expiresAtMs > this.nowMs
      );
      return {
        version: 2,
        registrationId: registration.registrationId,
        state: hasPendingClaim ? "waiting_for_code" : "waiting_for_scan",
        pairId: null,
        bundleId: null,
        shareIndex: null,
        role: null,
        shareContext: null,
        ownHpkePublicKey: registration.hpkePublicKey,
        peerHpkePublicKey: null,
        hpkeEncapsulation: null,
        ownConfirmed: false,
        peerConfirmed: false,
        expiresAtMs: registration.expiresAtMs
      };
    }
    const peer = side.role === "initiator" ? pair.sides.recipient : pair.sides.initiator;
    const peerRegistration = peer.registrationId
      ? this.registrations.get(peer.registrationId)
      : undefined;
    const bundle = this.bundles.get(pair.bundleId)!;
    return {
      version: 2,
      registrationId: registration.registrationId,
      state: pair.state === "confirmed"
        ? "confirmed"
        : pair.state === "paired"
          ? "paired"
          : "waiting_for_partner",
      pairId: pair.pairId,
      bundleId: pair.bundleId,
      shareIndex: pair.shareIndex,
      role: side.role,
      shareContext: {
        version: 2,
        sessionId: bundle.sessionId,
        bundleId: bundle.bundleId,
        initiatorUserId: bundle.initiatorUserId,
        recipientUserId: bundle.recipientUserId,
        shareIndex: pair.shareIndex,
        bundleSequence: bundle.bundleSequence
      },
      ownHpkePublicKey: registration.hpkePublicKey,
      peerHpkePublicKey: peerRegistration?.hpkePublicKey ?? null,
      hpkeEncapsulation: pair.hpkeEncapsulation,
      ownConfirmed: side.confirmed,
      peerConfirmed: peer.confirmed,
      expiresAtMs: Math.min(registration.expiresAtMs, this.expiresAt(pair.bundleId))
    };
  }

  private slot(pair: MemoryPair, role: StampHelperRole): StampHelperSlot {
    return {
      version: 2,
      pairId: pair.pairId,
      bundleId: pair.bundleId,
      shareIndex: pair.shareIndex,
      role,
      expiresAtMs: this.expiresAt(pair.bundleId)
    };
  }

  private storedClaim(claim: MemoryClaim, nowMs: number): StoredStampHelperClaim {
    const side = this.pairs.get(claim.pairId)!.sides[claim.role];
    return {
      claimId: claim.claimId,
      bundleId: claim.bundleId,
      pairId: claim.pairId,
      shareIndex: claim.shareIndex,
      role: claim.role,
      state: side.confirmed
        ? "completed"
        : claim.approved
          ? "approved"
          : claim.expiresAtMs <= nowMs
            ? "expired"
            : "pending",
      expiresAtMs: claim.expiresAtMs
    };
  }

  private expiresAt(bundleId: string): number {
    return this.records.find((item) => item.bundleId === bundleId)!.expiresAtMs;
  }
}

function createHarness() {
  const repository = new MemoryStampRepository(NOW_MS);
  let idCounter = 0;
  let tokenCounter = 0;
  const service = new StampService(repository, {
    now: () => NOW_MS,
    idFactory: (prefix) => `${prefix}_test_${idCounter++}`,
    tokenFactory: () => `${"A".repeat(42)}${String(tokenCounter++).padStart(2, "0")}`
  });
  return { repository, service };
}

function publicKey(value: number): string {
  return Buffer.from(new Uint8Array(32).fill(value)).toString("base64");
}

async function registerAndAttach(
  service: StampService,
  slot: StampHelperSlot,
  userId: string,
  keyValue: number
) {
  const registration = await service.registerHelper({ hpkePublicKey: publicKey(keyValue) });
  const linkCode = String(100_000 + keyValue).slice(-6);
  const claim = await service.attachHelper(
    {
      bundleId: slot.bundleId,
      pairId: slot.pairId,
      registrationId: registration.registrationId,
      linkCode
    },
    userId
  );
  await service.approveAttachmentClaim({
    registrationToken: registration.registrationToken,
    linkCode
  });
  return { ...registration, claimId: claim.claimId };
}

async function prepareReadyBundle() {
  const harness = createHarness();
  const created = await harness.service.createBundle({
    conversationId: "conversation_alice_bob",
    shareCount: 2,
    initiatorUserId: "alice",
    recipientUserId: "bob"
  });
  for (let index = 0; index < created.initiatorSlots.length; index += 1) {
    const initiator = await registerAndAttach(
      harness.service, created.initiatorSlots[index]!, "alice", index + 1
    );
    const recipient = await registerAndAttach(
      harness.service, created.recipientSlots[index]!, "bob", index + 11
    );
    await harness.service.publishHpkeEncapsulation({
      registrationToken: initiator.registrationToken,
      hpkeEncapsulation: publicKey(index + 21)
    });
    await harness.service.confirmHelper({ registrationToken: initiator.registrationToken });
    await harness.service.confirmHelper({ registrationToken: recipient.registrationToken });
  }
  return { ...harness, created };
}

function signedMessage(bundleId: string, messageId: string, privateKey: Uint8Array) {
  return signStampCiphertextMessage({
    version: 2,
    messageId,
    conversationId: "conversation_alice_bob",
    bundleId,
    senderUserId: "alice",
    recipientUserId: "bob",
    ciphertext: "PLMXO",
    createdAtMs: NOW_MS,
    senderSigningKeyId: ALICE_AUTH.deviceId
  }, privateKey);
}

describe("stamp relay helper setup", () => {
  it("puts only a public registration id in the QR and hashes the private token", async () => {
    const { repository, service } = createHarness();
    const registration = await service.registerHelper({ hpkePublicKey: publicKey(1) });
    const qr = stampHelperQrPayloadSchema.parse({
      version: 2,
      registrationId: registration.registrationId
    });
    expect(JSON.stringify(qr)).not.toContain(registration.registrationToken);
    expect(JSON.stringify(repository.registrations)).not.toContain(registration.registrationToken);
    expect([...repository.registrations.values()][0]!.accessTokenHash).toBe(
      createHash("sha256").update(registration.registrationToken).digest("hex")
    );
    await expect(
      service.getHelperStatus({ registrationToken: registration.registrationId })
    ).rejects.toThrow();
  });

  it("requires the borrowed phone's six-digit approval before attachment", async () => {
    const { service } = createHarness();
    const created = await service.createBundle({
      conversationId: "conversation_alice_bob",
      shareCount: 2,
      initiatorUserId: "alice",
      recipientUserId: "bob"
    });
    const helper = await service.registerHelper({ hpkePublicKey: publicKey(1) });
    await expect(
      service.attachHelper({
        bundleId: created.descriptor.bundleId,
        pairId: created.recipientSlots[0]!.pairId,
        registrationId: helper.registrationId,
        linkCode: "123456"
      }, "mallory")
    ).rejects.toThrow("does not match");
    const claim = await service.attachHelper({
      bundleId: created.descriptor.bundleId,
      pairId: created.initiatorSlots[0]!.pairId,
      registrationId: helper.registrationId,
      linkCode: "123456"
    }, "alice");
    expect(claim.role).toBe("initiator");
    expect(claim.state).toBe("pending");
    expect(
      await service.getHelperStatus({ registrationToken: helper.registrationToken })
    ).toMatchObject({ state: "waiting_for_code", pairId: null });
    await expect(
      service.approveAttachmentClaim({
        registrationToken: helper.registrationToken,
        linkCode: "654321"
      })
    ).rejects.toThrow("incorrect or expired");
    const approved = await service.approveAttachmentClaim({
      registrationToken: helper.registrationToken,
      linkCode: "123456"
    });
    expect(approved.helper).toMatchObject({ role: "initiator", pairId: claim.pairId });
    expect(
      await service.getAttachmentClaim(claim.claimId, "alice")
    ).toMatchObject({ state: "approved" });
  });

  it("lets either main phone recover its active slots through polling", async () => {
    const { service } = createHarness();
    const created = await service.createBundle({
      conversationId: "conversation_alice_bob",
      shareCount: 2,
      initiatorUserId: "alice",
      recipientUserId: "bob"
    });
    const alice = await registerAndAttach(
      service,
      created.initiatorSlots[0]!,
      "alice",
      1
    );
    const bob = await registerAndAttach(
      service,
      created.recipientSlots[0]!,
      "bob",
      11
    );
    await service.publishHpkeEncapsulation({
      registrationToken: alice.registrationToken,
      hpkeEncapsulation: publicKey(21)
    });
    await service.confirmHelper({ registrationToken: alice.registrationToken });
    await service.confirmHelper({ registrationToken: bob.registrationToken });

    await expect(
      service.getActiveBundle("conversation_alice_bob", "alice")
    ).resolves.toMatchObject({
      descriptor: { bundleId: created.descriptor.bundleId },
      helperSlots: [{ role: "initiator" }, { role: "initiator" }],
      completedShareIndexes: [0]
    });
    await expect(
      service.getActiveBundle("conversation_alice_bob", "bob")
    ).resolves.toMatchObject({
      helperSlots: [{ role: "recipient" }, { role: "recipient" }],
      completedShareIndexes: [0]
    });
  });

  it("pairs helpers, rejects the recipient as HPKE sender, and blocks early confirmation", async () => {
    const { service } = createHarness();
    const created = await service.createBundle({
      conversationId: "conversation_alice_bob",
      shareCount: 2,
      initiatorUserId: "alice",
      recipientUserId: "bob"
    });
    const alice = await registerAndAttach(service, created.initiatorSlots[0]!, "alice", 1);
    let status = await service.getHelperStatus({ registrationToken: alice.registrationToken });
    expect(status.state).toBe("waiting_for_partner");
    await expect(
      service.confirmHelper({ registrationToken: alice.registrationToken })
    ).rejects.toThrow("Both helpers must join");
    const bob = await registerAndAttach(service, created.recipientSlots[0]!, "bob", 11);
    status = await service.getHelperStatus({ registrationToken: alice.registrationToken });
    expect(status.state).toBe("paired");
    expect(status.peerHpkePublicKey).toBe(publicKey(11));
    await expect(service.publishHpkeEncapsulation({
      registrationToken: bob.registrationToken,
      hpkeEncapsulation: publicKey(21)
    })).rejects.toThrow("initiating helper");
    const hpkeReady = await service.publishHpkeEncapsulation({
      registrationToken: alice.registrationToken,
      hpkeEncapsulation: publicKey(21)
    });
    expect(hpkeReady.hpkeEncapsulation).toBe(publicKey(21));
    await service.confirmHelper({ registrationToken: alice.registrationToken });
    expect(
      await service.getAttachmentClaim(alice.claimId, "alice")
    ).toMatchObject({ state: "completed" });
  });

  it("becomes ready only after both ends of every pair confirm", async () => {
    const { service, created } = await prepareReadyBundle();
    expect((await service.getBundle(created.descriptor.bundleId, "alice")).state).toBe("ready");
  });
});

describe("atomic ciphertext acceptance", () => {
  it("allows exactly one concurrent message to consume a ready bundle", async () => {
    const { service, created } = await prepareReadyBundle();
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const signingPublicKey = Buffer.from(ed25519.getPublicKey(privateKey)).toString("base64");
    const attempts = await Promise.allSettled([
      service.acceptMessage(signedMessage(created.descriptor.bundleId, "message_race_001", privateKey), ALICE_AUTH, signingPublicKey),
      service.acceptMessage(signedMessage(created.descriptor.bundleId, "message_race_002", privateKey), ALICE_AUTH, signingPublicKey)
    ]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("rejects spoofed senders, signatures, and plaintext fields", async () => {
    const { service, created } = await prepareReadyBundle();
    const privateKey = new Uint8Array(32).fill(4);
    const signingPublicKey = Buffer.from(ed25519.getPublicKey(privateKey)).toString("base64");
    const message = signedMessage(created.descriptor.bundleId, "message_auth_001", privateKey);
    await expect(service.acceptMessage(
      message, { ...ALICE_AUTH, userId: "mallory" }, signingPublicKey
    )).rejects.toThrow("authenticated user");
    await expect(service.acceptMessage(
      { ...message, ciphertext: "AAAAA" }, ALICE_AUTH, signingPublicKey
    )).rejects.toThrow("signature");
    await expect(service.acceptMessage(
      { ...message, plaintext: "HELLO" } as SignedStampCiphertextMessage,
      ALICE_AUTH,
      signingPublicKey
    )).rejects.toThrow();
  });

  it("delivers only to the recipient and supports acknowledgement", async () => {
    const { service, created } = await prepareReadyBundle();
    const privateKey = new Uint8Array(32).fill(9);
    const signingPublicKey = Buffer.from(ed25519.getPublicKey(privateKey)).toString("base64");
    const message = signedMessage(created.descriptor.bundleId, "message_delivery_001", privateKey);
    await service.acceptMessage(message, ALICE_AUTH, signingPublicKey);
    expect(await service.getPendingMessages("alice")).toEqual([]);
    expect(await service.getPendingMessages("bob")).toEqual([message]);
    await service.acknowledgeMessage(message.messageId, "bob");
    expect(await service.getPendingMessages("bob")).toEqual([]);
  });
});
