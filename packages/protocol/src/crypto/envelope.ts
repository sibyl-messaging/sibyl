import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  encryptedEnvelopeSchema,
  type EncryptedEnvelope,
  type TokenStream
} from "../types/transport.js";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  utf8ToBytes
} from "../utils/encoding.js";
import { deriveSharedSecret, generateX25519KeyPair } from "./x25519.js";

const AES_KEY_BYTES = 32;
const AES_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const DEFAULT_TTL_SEC = 86_400;

export interface EncryptEnvelopeInput {
  conversationId: string;
  senderDeviceId: string;
  tokenStream: TokenStream;
  recipientStaticPublicKey: Uint8Array;
  ttlSec?: number;
}

export interface DecryptEnvelopeInput {
  recipientStaticPrivateKey: Uint8Array;
  envelope: EncryptedEnvelope;
}

export function encryptTokenStreamEnvelope(
  input: EncryptEnvelopeInput
): EncryptedEnvelope {
  if (input.tokenStream.conversationId !== input.conversationId) {
    throw new Error("Token stream conversationId mismatch");
  }

  const eph = generateX25519KeyPair();
  const nonce = randomBytes(AES_NONCE_BYTES);
  const sharedSecret = deriveSharedSecret(eph.privateKey, input.recipientStaticPublicKey);

  const info = utf8ToBytes(`sibyl:v1:${input.conversationId}`);
  const keyMaterial = hkdf(sha256, sharedSecret, nonce, info, AES_KEY_BYTES);

  const aadPayload = {
    version: 1,
    conversationId: input.conversationId,
    senderDeviceId: input.senderDeviceId,
    createdAtMs: input.tokenStream.createdAtMs
  };

  const aadBytes = utf8ToBytes(JSON.stringify(aadPayload));
  const plaintext = utf8ToBytes(JSON.stringify(input.tokenStream));

  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyMaterial), nonce);
  cipher.setAAD(Buffer.from(aadBytes));

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
    cipher.getAuthTag()
  ]);

  const envelope: EncryptedEnvelope = {
    envelopeId: randomUUID(),
    conversationId: input.conversationId,
    senderDeviceId: input.senderDeviceId,
    ephPubKey: bytesToBase64(eph.publicKey),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    aad: bytesToBase64(aadBytes),
    ttlSec: input.ttlSec ?? DEFAULT_TTL_SEC
  };

  return encryptedEnvelopeSchema.parse(envelope);
}

export function decryptTokenStreamEnvelope(
  input: DecryptEnvelopeInput
): TokenStream {
  const envelope = encryptedEnvelopeSchema.parse(input.envelope);

  const nonce = base64ToBytes(envelope.nonce);
  if (nonce.length !== AES_NONCE_BYTES) {
    throw new Error("Invalid nonce length");
  }

  const ephPubKey = base64ToBytes(envelope.ephPubKey);
  const aadBytes = base64ToBytes(envelope.aad);
  const ciphertextWithTag = base64ToBytes(envelope.ciphertext);

  if (ciphertextWithTag.length <= GCM_TAG_BYTES) {
    throw new Error("Ciphertext too short");
  }

  const sharedSecret = deriveSharedSecret(input.recipientStaticPrivateKey, ephPubKey);
  const info = utf8ToBytes(`sibyl:v1:${envelope.conversationId}`);
  const keyMaterial = hkdf(sha256, sharedSecret, nonce, info, AES_KEY_BYTES);

  const encryptedBytes = ciphertextWithTag.slice(0, -GCM_TAG_BYTES);
  const authTag = ciphertextWithTag.slice(-GCM_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyMaterial), Buffer.from(nonce));
  decipher.setAAD(Buffer.from(aadBytes));
  decipher.setAuthTag(Buffer.from(authTag));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedBytes)),
    decipher.final()
  ]);

  const parsed = JSON.parse(bytesToUtf8(plaintext)) as TokenStream;
  return parsed;
}
