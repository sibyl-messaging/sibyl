import { createHash, randomBytes } from "node:crypto";

import {
  approveStampHelperClaimRequestSchema,
  attachStampHelperRequestSchema,
  createStampBundleRequestSchema,
  publishStampHelperEncapsulationRequestSchema,
  registeredStampHelperSchema,
  registerStampHelperRequestSchema,
  signedStampCiphertextMessageSchema,
  stampBundleDescriptorSchema,
  stampBundleSetupSchema,
  stampHelperCapabilityRequestSchema,
  stampHelperAttachmentClaimSchema,
  stampHelperAttachmentClaimStatusSchema,
  stampHelperSlotSchema,
  stampHelperStatusSchema,
  verifyStampCiphertextMessageSignature,
  type ApproveStampHelperClaimRequest,
  type AttachStampHelperRequest,
  type CreateStampBundleRequest,
  type PublishStampHelperEncapsulationRequest,
  type RegisteredStampHelper,
  type RegisterStampHelperRequest,
  type SignedStampCiphertextMessage,
  type StampBundleDescriptor,
  type StampBundleSetup,
  type StampHelperAttachmentClaim,
  type StampHelperAttachmentClaimStatus,
  type StampHelperCapabilityRequest,
  type StampHelperRole,
  type StampHelperSlot,
  type StampHelperStatus
} from "@sibyl/protocol";

import type { AuthContext } from "../types/domain.js";
import { HttpError } from "../utils/httpError.js";
import { nextId } from "../utils/ids.js";
import type {
  CreateStampBundleRecord,
  StampRelayRepository
} from "./stampRepository.js";

const HELPER_SETUP_TTL_MS = 30 * 60 * 1000;
const HPKE_X25519_PUBLIC_KEY_BYTES = 32;

export interface CreateStampBundleInput extends CreateStampBundleRequest {
  initiatorUserId: string;
  recipientUserId: string;
}

export interface CreatedStampBundle {
  descriptor: StampBundleDescriptor;
  initiatorSlots: StampHelperSlot[];
  recipientSlots: StampHelperSlot[];
}

export interface ConfirmedStampHelper {
  helper: StampHelperStatus;
  bundle: StampBundleDescriptor;
}

export interface StampServiceOptions {
  now?: () => number;
  idFactory?: (prefix: string) => string;
  tokenFactory?: () => string;
}

export class StampService {
  private readonly now: () => number;
  private readonly idFactory: (prefix: string) => string;
  private readonly tokenFactory: () => string;

  constructor(
    private readonly repository: StampRelayRepository,
    options: StampServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? nextId;
    this.tokenFactory =
      options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  async createBundle(input: CreateStampBundleInput): Promise<CreatedStampBundle> {
    const request = createStampBundleRequestSchema.parse({
      conversationId: input.conversationId,
      shareCount: input.shareCount
    });
    if (input.initiatorUserId === input.recipientUserId) {
      throw new HttpError(400, "A stamp bundle requires two different users");
    }

    const bundleId = this.idFactory("stb");
    const sessionId = this.idFactory("sts");
    const expiresAtMs = this.now() + HELPER_SETUP_TTL_MS;
    const initiatorSlots: StampHelperSlot[] = [];
    const recipientSlots: StampHelperSlot[] = [];
    const record: CreateStampBundleRecord = {
      bundleId,
      sessionId,
      conversationId: request.conversationId,
      initiatorUserId: input.initiatorUserId,
      recipientUserId: input.recipientUserId,
      shareCount: request.shareCount,
      expiresAtMs,
      pairs: []
    };

    for (let shareIndex = 0; shareIndex < request.shareCount; shareIndex += 1) {
      const pairId = this.idFactory("stp");
      const baseSlot = {
        version: 2 as const,
        pairId,
        bundleId,
        shareIndex,
        expiresAtMs
      };
      initiatorSlots.push(
        stampHelperSlotSchema.parse({
          ...baseSlot,
          role: "initiator"
        })
      );
      recipientSlots.push(
        stampHelperSlotSchema.parse({
          ...baseSlot,
          role: "recipient"
        })
      );
      record.pairs.push({
        pairId,
        shareIndex
      });
    }

    const descriptor = stampBundleDescriptorSchema.parse(
      await this.repository.createBundle(record)
    );
    return { descriptor, initiatorSlots, recipientSlots };
  }

  async getBundle(bundleId: string, userId: string): Promise<StampBundleDescriptor> {
    const descriptor = await this.repository.getBundleForUser(bundleId, userId);
    if (!descriptor) {
      throw new HttpError(404, "Stamp bundle not found");
    }
    return stampBundleDescriptorSchema.parse(descriptor);
  }

  async getActiveBundle(
    conversationId: string,
    userId: string
  ): Promise<StampBundleSetup | null> {
    const descriptor = await this.repository.getLatestBundleForConversationAndUser(
      conversationId,
      userId,
      this.now()
    );
    if (!descriptor) {
      return null;
    }
    const role: StampHelperRole =
      descriptor.initiatorUserId === userId ? "initiator" : "recipient";
    const helperSlots = await this.repository.getHelperSlots(
      descriptor.bundleId,
      role
    );
    const completedShareIndexes =
      await this.repository.getCompletedShareIndexes(
        descriptor.bundleId,
        role
      );
    return stampBundleSetupSchema.parse({
      descriptor,
      helperSlots,
      completedShareIndexes
    });
  }

  async registerHelper(
    rawInput: RegisterStampHelperRequest
  ): Promise<RegisteredStampHelper> {
    const input = registerStampHelperRequestSchema.parse(rawInput);
    assertCanonicalBase64Length(
      input.hpkePublicKey,
      HPKE_X25519_PUBLIC_KEY_BYTES,
      "hpkePublicKey"
    );
    const registrationId = this.idFactory("sth");
    const registrationToken = this.tokenFactory();
    const expiresAtMs = this.now() + HELPER_SETUP_TTL_MS;
    await this.repository.registerHelper({
      registrationId,
      accessTokenHash: hashCapabilityToken(registrationToken),
      hpkePublicKey: input.hpkePublicKey,
      expiresAtMs
    });
    return registeredStampHelperSchema.parse({
      version: 2,
      registrationId,
      registrationToken,
      hpkePublicKey: input.hpkePublicKey,
      expiresAtMs
    });
  }

  async attachHelper(
    rawInput: AttachStampHelperRequest,
    userId: string
  ): Promise<StampHelperAttachmentClaim> {
    const input = attachStampHelperRequestSchema.parse(rawInput);
    const claim = await this.repository.createAttachmentClaim({
      claimId: this.idFactory("stc"),
      bundleId: input.bundleId,
      pairId: input.pairId,
      registrationId: input.registrationId,
      userId,
      linkCodeHash: hashCapabilityToken(input.linkCode),
      nowMs: this.now()
    });
    if (!claim) {
      throw new HttpError(
        409,
        "That helper QR is expired, already linked, or does not match this slot"
      );
    }
    return stampHelperAttachmentClaimSchema.parse({
      version: 2,
      ...claim,
      linkCode: input.linkCode
    });
  }

  async getAttachmentClaim(
    claimId: string,
    userId: string
  ): Promise<StampHelperAttachmentClaimStatus> {
    const claim = await this.repository.getAttachmentClaim(
      claimId,
      userId,
      this.now()
    );
    if (!claim) {
      throw new HttpError(404, "Helper link request not found");
    }
    return stampHelperAttachmentClaimStatusSchema.parse({
      version: 2,
      ...claim
    });
  }

  async approveAttachmentClaim(
    rawInput: ApproveStampHelperClaimRequest
  ): Promise<ConfirmedStampHelper> {
    const input = approveStampHelperClaimRequestSchema.parse(rawInput);
    const helper = await this.repository.approveAttachmentClaim(
      hashCapabilityToken(input.registrationToken),
      hashCapabilityToken(input.linkCode),
      this.now()
    );
    if (!helper?.bundleId) {
      throw new HttpError(409, "That six-digit code is incorrect or expired");
    }
    const bundle = await this.repository.getBundleById(helper.bundleId);
    if (!bundle) {
      throw new HttpError(404, "Stamp bundle not found");
    }
    return {
      helper: stampHelperStatusSchema.parse(helper),
      bundle: stampBundleDescriptorSchema.parse(bundle)
    };
  }

  async getHelperStatus(
    rawInput: StampHelperCapabilityRequest
  ): Promise<StampHelperStatus> {
    const input = stampHelperCapabilityRequestSchema.parse(rawInput);
    const helper = await this.repository.getHelperStatus(
      hashCapabilityToken(input.registrationToken),
      this.now()
    );
    if (!helper) {
      throw new HttpError(404, "Active helper session not found");
    }
    return stampHelperStatusSchema.parse(helper);
  }

  async publishHpkeEncapsulation(
    rawInput: PublishStampHelperEncapsulationRequest
  ): Promise<StampHelperStatus> {
    const input = publishStampHelperEncapsulationRequestSchema.parse(rawInput);
    assertCanonicalBase64Length(
      input.hpkeEncapsulation,
      HPKE_X25519_PUBLIC_KEY_BYTES,
      "hpkeEncapsulation"
    );
    const helper = await this.repository.publishHpkeEncapsulation(
      hashCapabilityToken(input.registrationToken),
      input.hpkeEncapsulation,
      this.now()
    );
    if (!helper) {
      throw new HttpError(
        409,
        "Only the paired initiating helper can publish the HPKE encapsulation"
      );
    }
    return stampHelperStatusSchema.parse(helper);
  }

  async confirmHelper(
    rawInput: StampHelperCapabilityRequest
  ): Promise<ConfirmedStampHelper> {
    const input = stampHelperCapabilityRequestSchema.parse(rawInput);
    const helper = await this.repository.confirmHelper(
      hashCapabilityToken(input.registrationToken),
      this.now()
    );
    if (!helper) {
      throw new HttpError(
        409,
        "Both helpers must join and finish HPKE setup before confirmation"
      );
    }
    if (!helper.bundleId) {
      throw new HttpError(409, "Helper is not attached to a stamp bundle");
    }
    const bundle = await this.repository.getBundleById(helper.bundleId);
    if (!bundle) {
      throw new HttpError(404, "Stamp bundle not found");
    }
    return {
      helper: stampHelperStatusSchema.parse(helper),
      bundle: stampBundleDescriptorSchema.parse(bundle)
    };
  }

  async acceptMessage(
    rawMessage: SignedStampCiphertextMessage,
    auth: AuthContext,
    signingPublicKey: string
  ): Promise<SignedStampCiphertextMessage> {
    const message = signedStampCiphertextMessageSchema.parse(rawMessage);
    if (message.senderUserId !== auth.userId) {
      throw new HttpError(403, "Message sender does not match authenticated user");
    }
    if (message.senderSigningKeyId !== auth.deviceId) {
      throw new HttpError(403, "Message signing key does not match authenticated device");
    }
    const publicKey = decodeCanonicalBase64(
      signingPublicKey,
      32,
      "signingPublicKey"
    );
    if (!verifyStampCiphertextMessageSignature(message, publicKey)) {
      throw new HttpError(401, "Invalid ciphertext message signature");
    }
    const accepted = await this.repository.consumeBundleAndStoreMessage(
      message,
      this.now()
    );
    if (!accepted) {
      throw new HttpError(
        409,
        "Stamp bundle is unavailable, expired, mismatched, or already consumed"
      );
    }
    return message;
  }

  async getPendingMessages(userId: string): Promise<SignedStampCiphertextMessage[]> {
    const messages = await this.repository.getPendingMessages(userId);
    return messages.map((message) =>
      signedStampCiphertextMessageSchema.parse(message)
    );
  }

  async acknowledgeMessage(messageId: string, userId: string): Promise<void> {
    const acknowledged = await this.repository.acknowledgeMessage(
      messageId,
      userId
    );
    if (!acknowledged) {
      throw new HttpError(404, "Pending stamp message not found");
    }
  }
}

function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function assertCanonicalBase64Length(
  value: string,
  expectedLength: number,
  field: string
): void {
  decodeCanonicalBase64(value, expectedLength, field);
}

function decodeCanonicalBase64(
  value: string,
  expectedLength: number,
  field: string
): Uint8Array {
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length !== expectedLength ||
    Buffer.from(bytes).toString("base64") !== value
  ) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return Uint8Array.from(bytes);
}
