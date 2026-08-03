import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it } from "vitest";

import {
  assertStampBundleTransition,
  assertStampBundleUsable,
  assertStampMessageCanUseBundle,
  decodeWithStampBundle,
  decodeWithStampShare,
  deriveStampShare,
  encodeStampShareContext,
  encodeWithStampBundle,
  encodeWithStampShare,
  formatStampShare,
  formatPublicStampLabel,
  mapUniformBytesToStampValues,
  parseStampShare,
  signStampCiphertextMessage,
  unsignedStampCiphertextMessageSchema,
  verifyStampCiphertextMessageSignature,
  type StampBundleDescriptor,
  type StampShare,
  type StampShareContext,
  type UnsignedStampCiphertextMessage
} from "../src/index.js";

const FIRST_SHARE: StampShare = [
  3, 1, 20, 4, 17, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
];

const SECOND_SHARE: StampShare = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
  18, 19, 20, 21, 22, 23, 24, 25, 0, 1, 2, 3, 4
];

const SHARE_CONTEXT: StampShareContext = {
  version: 2,
  sessionId: "session_test_001",
  bundleId: "bundle_test_001",
  initiatorUserId: "alice",
  recipientUserId: "bob",
  shareIndex: 0,
  bundleSequence: 7
};

const UNSIGNED_MESSAGE: UnsignedStampCiphertextMessage = {
  version: 2,
  messageId: "message_test_001",
  conversationId: "conversation_alice_bob",
  bundleId: "bundle_test_001",
  senderUserId: "alice",
  recipientUserId: "bob",
  ciphertext: "PLMXO",
  createdAtMs: 1_750_000_000_000,
  senderSigningKeyId: "alice_signing_key_001"
};

const READY_BUNDLE: StampBundleDescriptor = {
  version: 2,
  sessionId: "session_test_001",
  bundleId: "bundle_test_001",
  initiatorUserId: "alice",
  recipientUserId: "bob",
  shareCount: 2,
  bundleSequence: 7,
  createdAtMs: 1_749_999_999_000,
  state: "ready"
};

describe("paper wheel math", () => {
  it("matches the paper wheel examples", () => {
    expect(encodeWithStampShare("HI", FIRST_SHARE)).toBe("KJ");
    expect(decodeWithStampShare("KJ", FIRST_SHARE)).toBe("HI");
    expect(encodeWithStampShare("HELLO", FIRST_SHARE)).toBe("KFFPF");
  });

  it("combines multiple shares and decodes them again", () => {
    const ciphertext = encodeWithStampBundle("HELLO", [
      FIRST_SHARE,
      SECOND_SHARE
    ]);
    expect(ciphertext).toBe("PLMXO");
    expect(
      decodeWithStampBundle(ciphertext, [FIRST_SHARE, SECOND_SHARE])
    ).toBe("HELLO");
  });

  it("formats and parses the 00-25 values written on paper", () => {
    const written = formatStampShare(FIRST_SHARE);
    expect(written.startsWith("03 01 20 04 17")).toBe(true);
    expect(parseStampShare(written)).toEqual(FIRST_SHARE);
  });

  it("rejects text, lengths, and bundles the wheel cannot safely use", () => {
    expect(() => encodeWithStampShare("HELLO BOB", FIRST_SHARE)).toThrow();
    expect(() => encodeWithStampShare("a", FIRST_SHARE)).toThrow();
    expect(() => encodeWithStampBundle("HELLO", [FIRST_SHARE])).toThrow();
    expect(() => parseStampShare("26 ".repeat(26))).toThrow();
  });
});

describe("public paper stamp labels", () => {
  it("makes the same short, paper-safe label from the same bundle", () => {
    const first = formatPublicStampLabel("bundle_test_001");
    expect(first).toBe(formatPublicStampLabel("bundle_test_001"));
    expect(first).toMatch(/^STAMP [2-9A-HJ-NP-Z]{6}$/);
  });

  it("changes when the bundle changes", () => {
    expect(formatPublicStampLabel("bundle_test_001")).not.toBe(
      formatPublicStampLabel("bundle_test_002")
    );
  });
});

describe("unbiased helper-pair share derivation", () => {
  it("rejects bytes outside the largest complete 26-value range", () => {
    expect(
      mapUniformBytesToStampValues(
        Uint8Array.from([0, 25, 26, 233, 234, 255])
      )
    ).toEqual([0, 25, 0, 25]);
    expect(mapUniformBytesToStampValues(Uint8Array.from([1]), 0)).toEqual([]);
  });

  it("matches the fixed Protocol v2 derivation vector", () => {
    const exporterSecret = Uint8Array.from({ length: 32 }, (_, index) => index);
    expect(deriveStampShare(exporterSecret, SHARE_CONTEXT)).toEqual([
      13, 9, 6, 17, 2, 16, 14, 8, 11, 14, 7, 21, 4,
      9, 9, 17, 21, 5, 21, 16, 17, 19, 24, 14, 12, 6
    ]);
  });

  it("binds the share to every canonical session field", () => {
    const exporterSecret = new Uint8Array(32).fill(7);
    const first = deriveStampShare(exporterSecret, SHARE_CONTEXT);
    const second = deriveStampShare(exporterSecret, {
      ...SHARE_CONTEXT,
      recipientUserId: "mallory"
    });
    expect(first).not.toEqual(second);
    expect(encodeStampShareContext(SHARE_CONTEXT)).toEqual(
      encodeStampShareContext({ ...SHARE_CONTEXT })
    );
  });

  it("refuses low-entropy exporter material", () => {
    expect(() => deriveStampShare(new Uint8Array(31), SHARE_CONTEXT)).toThrow(
      "at least 32 bytes"
    );
  });
});

describe("bundle lifecycle and recipient binding", () => {
  it("allows only the forward one-use lifecycle", () => {
    expect(() => assertStampBundleTransition("proposed", "pairing")).not.toThrow();
    expect(() => assertStampBundleTransition("pairing", "ready")).not.toThrow();
    expect(() => assertStampBundleTransition("ready", "consumed")).not.toThrow();
    expect(() => assertStampBundleTransition("consumed", "ready")).toThrow();
    expect(() => assertStampBundleTransition("ready", "ready")).toThrow();
    expect(() => assertStampBundleUsable("consumed")).toThrow();
  });

  it("accepts only the intended sender, recipient, and bundle", () => {
    expect(() =>
      assertStampMessageCanUseBundle(UNSIGNED_MESSAGE, READY_BUNDLE)
    ).not.toThrow();
    expect(() =>
      assertStampMessageCanUseBundle(
        { ...UNSIGNED_MESSAGE, recipientUserId: "mallory" },
        READY_BUNDLE
      )
    ).toThrow("different recipient");
    expect(() =>
      assertStampMessageCanUseBundle(UNSIGNED_MESSAGE, {
        ...READY_BUNDLE,
        state: "consumed"
      })
    ).toThrow("not usable");
  });
});

describe("signed ciphertext-only messages", () => {
  it("verifies fixed-key messages and rejects tampering", () => {
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const publicKey = ed25519.getPublicKey(privateKey);
    const signed = signStampCiphertextMessage(UNSIGNED_MESSAGE, privateKey);

    expect(verifyStampCiphertextMessageSignature(signed, publicKey)).toBe(true);
    expect(
      verifyStampCiphertextMessageSignature(
        { ...signed, ciphertext: "PLMXP" },
        publicKey
      )
    ).toBe(false);
    expect(
      verifyStampCiphertextMessageSignature(
        { ...signed, recipientUserId: "mallory" },
        publicKey
      )
    ).toBe(false);
  });

  it("rejects plaintext and other undeclared payload fields", () => {
    expect(() =>
      unsignedStampCiphertextMessageSchema.parse({
        ...UNSIGNED_MESSAGE,
        plaintext: "HELLO"
      })
    ).toThrow();
  });
});
