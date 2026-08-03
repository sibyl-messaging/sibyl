import { describe, expect, it } from "vitest";

import {
  decryptTokenStreamEnvelope,
  encryptTokenStreamEnvelope
} from "../src/crypto/envelope.js";
import { createTokenStream } from "../src/token/tokenStream.js";
import { generateX25519KeyPair } from "../src/crypto/x25519.js";

describe("envelope crypto", () => {
  it("encrypts and decrypts token streams", () => {
    const recipient = generateX25519KeyPair();
    const tokenStream = createTokenStream({
      conversationId: "conv_abc",
      tokens: [4, 7, 11, 22]
    });

    const envelope = encryptTokenStreamEnvelope({
      conversationId: "conv_abc",
      senderDeviceId: "device_1",
      tokenStream,
      recipientStaticPublicKey: recipient.publicKey
    });

    const decrypted = decryptTokenStreamEnvelope({
      recipientStaticPrivateKey: recipient.privateKey,
      envelope
    });

    expect(decrypted.tokens).toEqual(tokenStream.tokens);
    expect(decrypted.conversationId).toBe(tokenStream.conversationId);
  });

  it("fails decryption when ciphertext is tampered", () => {
    const recipient = generateX25519KeyPair();
    const tokenStream = createTokenStream({
      conversationId: "conv_tamper",
      tokens: [8, 9, 10]
    });

    const envelope = encryptTokenStreamEnvelope({
      conversationId: "conv_tamper",
      senderDeviceId: "device_1",
      tokenStream,
      recipientStaticPublicKey: recipient.publicKey
    });

    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] = bytes[0] ^ 0xff;

    expect(() =>
      decryptTokenStreamEnvelope({
        recipientStaticPrivateKey: recipient.privateKey,
        envelope: {
          ...envelope,
          ciphertext: bytes.toString("base64")
        }
      })
    ).toThrow();
  });
});
