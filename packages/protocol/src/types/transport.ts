import { z } from "zod";

export const HOLE_GRID_WIDTH = 12;
export const HOLE_GRID_HEIGHT = 12;
export const HOLE_COUNT = HOLE_GRID_WIDTH * HOLE_GRID_HEIGHT;
export const MAX_TOKEN_STREAM_LENGTH = 280;

export type HoleId = number;

export const holeIdSchema = z
  .number()
  .int()
  .min(0)
  .max(HOLE_COUNT - 1);

export const tokenStreamSchema = z.object({
  version: z.literal(1),
  conversationId: z.string().min(1),
  pageIndex: z.number().int().min(0),
  tokens: z.array(holeIdSchema).max(MAX_TOKEN_STREAM_LENGTH),
  createdAtMs: z.number().int().positive()
});

export type TokenStream = z.infer<typeof tokenStreamSchema>;

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

export const allowedCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ ." as const;
export type AllowedGlyph = (typeof allowedCharset)[number];
