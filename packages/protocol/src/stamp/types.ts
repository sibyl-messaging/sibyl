import { z } from "zod";

import {
  STAMP_LENGTH,
  STAMP_MAX_SHARE_COUNT,
  STAMP_MIN_SHARE_COUNT,
  STAMP_PROTOCOL_VERSION
} from "./constants.js";

const identifierSchema = z.string().min(1).max(200);

export const stampShareSchema = z
  .array(z.number().int().min(0).max(25))
  .length(STAMP_LENGTH);

export type StampShare = z.infer<typeof stampShareSchema>;

export const stampShareContextSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    sessionId: identifierSchema,
    bundleId: identifierSchema,
    initiatorUserId: identifierSchema,
    recipientUserId: identifierSchema,
    shareIndex: z.number().int().min(0).max(STAMP_MAX_SHARE_COUNT - 1),
    bundleSequence: z.number().int().nonnegative()
  })
  .strict();

export type StampShareContext = z.infer<typeof stampShareContextSchema>;

export const stampBundleStateSchema = z.enum([
  "proposed",
  "pairing",
  "ready",
  "consumed",
  "expired",
  "failed"
]);

export type StampBundleState = z.infer<typeof stampBundleStateSchema>;

export const stampBundleDescriptorSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    sessionId: identifierSchema,
    bundleId: identifierSchema,
    initiatorUserId: identifierSchema,
    recipientUserId: identifierSchema,
    shareCount: z
      .number()
      .int()
      .min(STAMP_MIN_SHARE_COUNT)
      .max(STAMP_MAX_SHARE_COUNT),
    bundleSequence: z.number().int().nonnegative(),
    createdAtMs: z.number().int().positive(),
    state: stampBundleStateSchema
  })
  .strict();

export type StampBundleDescriptor = z.infer<
  typeof stampBundleDescriptorSchema
>;

export const stampHelperRoleSchema = z.enum(["initiator", "recipient"]);
export type StampHelperRole = z.infer<typeof stampHelperRoleSchema>;

export const stampHelperPairStateSchema = z.enum([
  "waiting",
  "paired",
  "confirmed"
]);
export type StampHelperPairState = z.infer<
  typeof stampHelperPairStateSchema
>;

const base64ValueSchema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
const capabilityTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,200}$/);
export const stampHelperLinkCodeSchema = z.string().regex(/^\d{6}$/);

export const createStampBundleRequestSchema = z
  .object({
    conversationId: identifierSchema,
    shareCount: z
      .number()
      .int()
      .min(STAMP_MIN_SHARE_COUNT)
      .max(STAMP_MAX_SHARE_COUNT)
  })
  .strict();

export type CreateStampBundleRequest = z.infer<
  typeof createStampBundleRequestSchema
>;

export const stampHelperSlotSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    pairId: identifierSchema,
    bundleId: identifierSchema,
    shareIndex: z.number().int().min(0).max(STAMP_MAX_SHARE_COUNT - 1),
    role: stampHelperRoleSchema,
    expiresAtMs: z.number().int().positive()
  })
  .strict();

export type StampHelperSlot = z.infer<typeof stampHelperSlotSchema>;

export const stampBundleSetupSchema = z
  .object({
    descriptor: stampBundleDescriptorSchema,
    helperSlots: z.array(stampHelperSlotSchema),
    completedShareIndexes: z.array(
      z.number().int().min(0).max(STAMP_MAX_SHARE_COUNT - 1)
    )
  })
  .strict();

export type StampBundleSetup = z.infer<typeof stampBundleSetupSchema>;

export const registerStampHelperRequestSchema = z
  .object({
    hpkePublicKey: base64ValueSchema
  })
  .strict();

export type RegisterStampHelperRequest = z.infer<
  typeof registerStampHelperRequestSchema
>;

export const registeredStampHelperSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    registrationId: identifierSchema,
    registrationToken: capabilityTokenSchema,
    hpkePublicKey: base64ValueSchema,
    expiresAtMs: z.number().int().positive()
  })
  .strict();

export type RegisteredStampHelper = z.infer<
  typeof registeredStampHelperSchema
>;

export const stampHelperQrPayloadSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    registrationId: identifierSchema
  })
  .strict();

export type StampHelperQrPayload = z.infer<typeof stampHelperQrPayloadSchema>;

export const attachStampHelperRequestSchema = z
  .object({
    bundleId: identifierSchema,
    pairId: identifierSchema,
    registrationId: identifierSchema,
    linkCode: stampHelperLinkCodeSchema
  })
  .strict();

export type AttachStampHelperRequest = z.infer<
  typeof attachStampHelperRequestSchema
>;

export const stampHelperAttachmentClaimSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    claimId: identifierSchema,
    bundleId: identifierSchema,
    pairId: identifierSchema,
    shareIndex: z.number().int().min(0).max(STAMP_MAX_SHARE_COUNT - 1),
    role: stampHelperRoleSchema,
    linkCode: stampHelperLinkCodeSchema,
    state: z.enum(["pending", "approved", "completed", "expired"]),
    expiresAtMs: z.number().int().positive()
  })
  .strict();

export type StampHelperAttachmentClaim = z.infer<
  typeof stampHelperAttachmentClaimSchema
>;

export const stampHelperAttachmentClaimStatusSchema =
  stampHelperAttachmentClaimSchema.omit({ linkCode: true });

export type StampHelperAttachmentClaimStatus = z.infer<
  typeof stampHelperAttachmentClaimStatusSchema
>;

export const approveStampHelperClaimRequestSchema = z
  .object({
    registrationToken: capabilityTokenSchema,
    linkCode: stampHelperLinkCodeSchema
  })
  .strict();

export type ApproveStampHelperClaimRequest = z.infer<
  typeof approveStampHelperClaimRequestSchema
>;

export const stampHelperCapabilityRequestSchema = z
  .object({
    registrationToken: capabilityTokenSchema
  })
  .strict();

export type StampHelperCapabilityRequest = z.infer<
  typeof stampHelperCapabilityRequestSchema
>;

export const publishStampHelperEncapsulationRequestSchema = z
  .object({
    registrationToken: capabilityTokenSchema,
    hpkeEncapsulation: base64ValueSchema
  })
  .strict();

export type PublishStampHelperEncapsulationRequest = z.infer<
  typeof publishStampHelperEncapsulationRequestSchema
>;

export const stampHelperStatusSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    registrationId: identifierSchema,
    state: z.enum([
      "waiting_for_scan",
      "waiting_for_code",
      "waiting_for_partner",
      "paired",
      "confirmed"
    ]),
    pairId: identifierSchema.nullable(),
    bundleId: identifierSchema.nullable(),
    shareIndex: z
      .number()
      .int()
      .min(0)
      .max(STAMP_MAX_SHARE_COUNT - 1)
      .nullable(),
    role: stampHelperRoleSchema.nullable(),
    shareContext: stampShareContextSchema.nullable(),
    ownHpkePublicKey: base64ValueSchema,
    peerHpkePublicKey: base64ValueSchema.nullable(),
    hpkeEncapsulation: base64ValueSchema.nullable(),
    ownConfirmed: z.boolean(),
    peerConfirmed: z.boolean(),
    expiresAtMs: z.number().int().positive()
  })
  .strict();

export type StampHelperStatus = z.infer<typeof stampHelperStatusSchema>;

export const unsignedStampCiphertextMessageSchema = z
  .object({
    version: z.literal(STAMP_PROTOCOL_VERSION),
    messageId: identifierSchema,
    conversationId: identifierSchema,
    bundleId: identifierSchema,
    senderUserId: identifierSchema,
    recipientUserId: identifierSchema,
    ciphertext: z.string().regex(/^[A-Z]{1,26}$/),
    createdAtMs: z.number().int().positive(),
    senderSigningKeyId: identifierSchema
  })
  .strict();

export type UnsignedStampCiphertextMessage = z.infer<
  typeof unsignedStampCiphertextMessageSchema
>;

export const signedStampCiphertextMessageSchema =
  unsignedStampCiphertextMessageSchema.extend({
    signature: z.string().min(1)
  });

export type SignedStampCiphertextMessage = z.infer<
  typeof signedStampCiphertextMessageSchema
>;
