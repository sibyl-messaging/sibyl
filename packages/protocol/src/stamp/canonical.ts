import { utf8ToBytes } from "../utils/encoding.js";
import {
  stampShareContextSchema,
  unsignedStampCiphertextMessageSchema,
  type StampShareContext,
  type UnsignedStampCiphertextMessage
} from "./types.js";

export function encodeStampShareContext(
  input: StampShareContext
): Uint8Array {
  const context = stampShareContextSchema.parse(input);
  return utf8ToBytes(
    JSON.stringify([
      "sibyl/stamp-share-context/v2",
      ["version", context.version],
      ["sessionId", context.sessionId],
      ["bundleId", context.bundleId],
      ["initiatorUserId", context.initiatorUserId],
      ["recipientUserId", context.recipientUserId],
      ["shareIndex", context.shareIndex],
      ["bundleSequence", context.bundleSequence]
    ])
  );
}

export function encodeStampCiphertextMessageForSigning(
  input: UnsignedStampCiphertextMessage
): Uint8Array {
  const message = unsignedStampCiphertextMessageSchema.parse(input);
  return utf8ToBytes(
    JSON.stringify([
      "sibyl/stamp-ciphertext-message/v2",
      ["version", message.version],
      ["messageId", message.messageId],
      ["conversationId", message.conversationId],
      ["bundleId", message.bundleId],
      ["senderUserId", message.senderUserId],
      ["recipientUserId", message.recipientUserId],
      ["ciphertext", message.ciphertext],
      ["createdAtMs", message.createdAtMs],
      ["senderSigningKeyId", message.senderSigningKeyId]
    ])
  );
}

