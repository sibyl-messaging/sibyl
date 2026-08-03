import { ed25519 } from "@noble/curves/ed25519";

import { base64ToBytes, bytesToBase64 } from "../utils/encoding.js";
import { encodeStampCiphertextMessageForSigning } from "./canonical.js";
import {
  signedStampCiphertextMessageSchema,
  unsignedStampCiphertextMessageSchema,
  type SignedStampCiphertextMessage,
  type UnsignedStampCiphertextMessage
} from "./types.js";

function normalizeEd25519PrivateKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length === 32) {
    return privateKey;
  }
  if (privateKey.length === 64) {
    return privateKey.slice(0, 32);
  }
  throw new Error("Ed25519 private key must contain 32 or 64 bytes");
}

export function signStampCiphertextMessage(
  rawMessage: UnsignedStampCiphertextMessage,
  privateKey: Uint8Array
): SignedStampCiphertextMessage {
  const message = unsignedStampCiphertextMessageSchema.parse(rawMessage);
  const signature = ed25519.sign(
    encodeStampCiphertextMessageForSigning(message),
    normalizeEd25519PrivateKey(privateKey)
  );
  return signedStampCiphertextMessageSchema.parse({
    ...message,
    signature: bytesToBase64(signature)
  });
}

export function verifyStampCiphertextMessageSignature(
  rawMessage: SignedStampCiphertextMessage,
  publicKey: Uint8Array
): boolean {
  try {
    const message = signedStampCiphertextMessageSchema.parse(rawMessage);
    const signature = base64ToBytes(message.signature);
    if (
      signature.length !== 64 ||
      bytesToBase64(signature) !== message.signature
    ) {
      return false;
    }
    const { signature: _signature, ...unsignedMessage } = message;
    return ed25519.verify(
      signature,
      encodeStampCiphertextMessageForSigning(unsignedMessage),
      publicKey
    );
  } catch {
    return false;
  }
}

