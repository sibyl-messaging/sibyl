import { z } from "zod";

export const encryptedEnvelopeSchema = z.object({
  envelopeId: z.string().min(12),
  conversationId: z.string().min(1),
  senderDeviceId: z.string().min(1),
  ephPubKey: z.string().min(1),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
  aad: z.string().min(1),
  ttlSec: z.number().int().positive()
});

export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;

export function assertNoPlaintextField(payload: Record<string, unknown>): void {
  if ("plaintext" in payload || "message" in payload || "text" in payload) {
    throw new Error("Plaintext fields are forbidden in runtime payloads");
  }
}
