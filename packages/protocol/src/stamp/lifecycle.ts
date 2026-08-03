import {
  stampBundleDescriptorSchema,
  stampBundleStateSchema,
  signedStampCiphertextMessageSchema,
  unsignedStampCiphertextMessageSchema,
  type SignedStampCiphertextMessage,
  type StampBundleDescriptor,
  type StampBundleState,
  type UnsignedStampCiphertextMessage
} from "./types.js";

const ALLOWED_TRANSITIONS: Readonly<
  Record<StampBundleState, readonly StampBundleState[]>
> = {
  proposed: ["pairing", "expired", "failed"],
  pairing: ["ready", "expired", "failed"],
  ready: ["consumed", "expired", "failed"],
  consumed: [],
  expired: [],
  failed: []
};

export function assertStampBundleTransition(
  rawFrom: StampBundleState,
  rawTo: StampBundleState
): void {
  const from = stampBundleStateSchema.parse(rawFrom);
  const to = stampBundleStateSchema.parse(rawTo);
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid stamp bundle transition: ${from} -> ${to}`);
  }
}

export function assertStampBundleUsable(rawState: StampBundleState): void {
  const state = stampBundleStateSchema.parse(rawState);
  if (state !== "ready") {
    throw new Error(`Stamp bundle is not usable in state: ${state}`);
  }
}

export function assertStampMessageCanUseBundle(
  rawMessage: UnsignedStampCiphertextMessage | SignedStampCiphertextMessage,
  rawBundle: StampBundleDescriptor
): void {
  const message = "signature" in rawMessage
    ? signedStampCiphertextMessageSchema.parse(rawMessage)
    : unsignedStampCiphertextMessageSchema.parse(rawMessage);
  const bundle = stampBundleDescriptorSchema.parse(rawBundle);
  assertStampBundleUsable(bundle.state);

  if (message.version !== bundle.version) {
    throw new Error("Message and stamp bundle protocol versions differ");
  }
  if (message.bundleId !== bundle.bundleId) {
    throw new Error("Message uses a different stamp bundle");
  }
  if (message.senderUserId !== bundle.initiatorUserId) {
    throw new Error("Stamp bundle belongs to a different sender");
  }
  if (message.recipientUserId !== bundle.recipientUserId) {
    throw new Error("Stamp bundle belongs to a different recipient");
  }
}
