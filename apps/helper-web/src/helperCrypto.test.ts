import { describe, expect, it } from "vitest";

import type { StampHelperStatus, StampShareContext } from "@sibyl/protocol";

import { HelperCryptoSession } from "./helperCrypto.js";

const context: StampShareContext = {
  version: 2,
  sessionId: "session_test",
  bundleId: "bundle_test",
  initiatorUserId: "alice",
  recipientUserId: "bob",
  shareIndex: 0,
  bundleSequence: 0
};

function status(
  role: "initiator" | "recipient",
  ownHpkePublicKey: string,
  peerHpkePublicKey: string,
  hpkeEncapsulation: string | null
): StampHelperStatus {
  return {
    version: 2,
    registrationId: `registration_${role}`,
    state: "paired",
    pairId: "pair_test",
    bundleId: context.bundleId,
    shareIndex: 0,
    role,
    shareContext: context,
    ownHpkePublicKey,
    peerHpkePublicKey,
    hpkeEncapsulation,
    ownConfirmed: false,
    peerConfirmed: false,
    expiresAtMs: Date.now() + 60_000
  };
}

describe("borrowed-phone HPKE", () => {
  it("derives the same paper stamp independently at both ends", async () => {
    const initiator = await HelperCryptoSession.create();
    const recipient = await HelperCryptoSession.create();
    const initiatorPublicKey = await initiator.publicKeyBase64();
    const recipientPublicKey = await recipient.publicKeyBase64();

    const sent = await initiator.deriveAsInitiator(
      status("initiator", initiatorPublicKey, recipientPublicKey, null)
    );
    const received = await recipient.deriveAsRecipient(
      status(
        "recipient",
        recipientPublicKey,
        initiatorPublicKey,
        sent.hpkeEncapsulation
      )
    );

    expect(received).toEqual(sent.stamp);
    expect(received).toHaveLength(26);
    initiator.destroy();
    recipient.destroy();
  });

  it("binds the stamp to the bundle context", async () => {
    const initiator = await HelperCryptoSession.create();
    const recipient = await HelperCryptoSession.create();
    const initiatorPublicKey = await initiator.publicKeyBase64();
    const recipientPublicKey = await recipient.publicKeyBase64();
    const sent = await initiator.deriveAsInitiator(
      status("initiator", initiatorPublicKey, recipientPublicKey, null)
    );
    const changed = status(
      "recipient",
      recipientPublicKey,
      initiatorPublicKey,
      sent.hpkeEncapsulation
    );
    changed.shareContext = { ...context, bundleSequence: 1 };
    const changedStamp = await recipient.deriveAsRecipient(changed);
    expect(changedStamp).not.toEqual(sent.stamp);
    initiator.destroy();
    recipient.destroy();
  });
});
