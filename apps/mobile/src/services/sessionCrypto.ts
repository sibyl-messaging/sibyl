import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  deriveSharedSecret,
  encryptedEnvelopeSchema,
  generateX25519KeyPair,
  type EncryptedEnvelope,
  type TokenStream
} from "@sibyl/protocol";
import { Buffer } from "buffer";

import { nextEnvelopeId } from "../utils/ids";

const NONCE_BYTES = 12;
const AES_KEY_BYTES = 32;
const TTL_SEC = 86_400;

export function encryptEnvelopeOnDevice(input: {
  conversationId: string;
  senderDeviceId: string;
  tokenStream: TokenStream;
  recipientStaticPublicKeyBase64: string;
}): EncryptedEnvelope {
  const recipientPublicKey = fromBase64(input.recipientStaticPublicKeyBase64);
  const eph = generateX25519KeyPair();
  const nonce = randomBytes(NONCE_BYTES);

  const sharedSecret = deriveSharedSecret(eph.privateKey, recipientPublicKey);
  const info = utf8ToBytes(`sibyl:v1:${input.conversationId}`);
  const key = hkdf(sha256, sharedSecret, nonce, info, AES_KEY_BYTES);

  const aad = utf8ToBytes(
    JSON.stringify({
      version: 1,
      conversationId: input.conversationId,
      senderDeviceId: input.senderDeviceId,
      createdAtMs: input.tokenStream.createdAtMs
    })
  );

  const plaintext = utf8ToBytes(JSON.stringify(input.tokenStream));
  const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);

  return encryptedEnvelopeSchema.parse({
    envelopeId: nextEnvelopeId(),
    conversationId: input.conversationId,
    senderDeviceId: input.senderDeviceId,
    ephPubKey: toBase64(eph.publicKey),
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    aad: toBase64(aad),
    ttlSec: TTL_SEC
  });
}

export function decryptEnvelopeOnDevice(input: {
  envelope: EncryptedEnvelope;
  recipientStaticPrivateKeyBase64: string;
}): TokenStream {
  const envelope = encryptedEnvelopeSchema.parse(input.envelope);
  const privateKey = fromBase64(input.recipientStaticPrivateKeyBase64);
  const ephPub = fromBase64(envelope.ephPubKey);
  const nonce = fromBase64(envelope.nonce);
  const aad = fromBase64(envelope.aad);
  const ciphertext = fromBase64(envelope.ciphertext);

  const sharedSecret = deriveSharedSecret(privateKey, ephPub);
  const info = utf8ToBytes(`sibyl:v1:${envelope.conversationId}`);
  const key = hkdf(sha256, sharedSecret, nonce, info, AES_KEY_BYTES);

  const plaintext = gcm(key, nonce, aad).decrypt(ciphertext);
  return JSON.parse(bytesToUtf8(plaintext)) as TokenStream;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function utf8ToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "utf8"));
}

function bytesToUtf8(value: Uint8Array): string {
  return Buffer.from(value).toString("utf8");
}
