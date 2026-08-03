import { sha256 } from "@noble/hashes/sha2.js";

import { utf8ToBytes } from "../utils/encoding.js";

const PUBLIC_STAMP_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PUBLIC_STAMP_LABEL_LENGTH = 6;

/**
 * Makes a short, non-secret name people can copy onto every paper share.
 * The label is only a matching aid. It is never used as key material.
 */
export function formatPublicStampLabel(bundleId: string): string {
  if (typeof bundleId !== "string" || bundleId.length < 1 || bundleId.length > 200) {
    throw new Error("bundleId must contain 1 to 200 characters");
  }

  const digest = sha256(utf8ToBytes(`sibyl/public-stamp-label/v2/${bundleId}`));
  const value = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength
  ).getUint32(0, false);
  let token = "";
  for (let index = 0; index < PUBLIC_STAMP_LABEL_LENGTH; index += 1) {
    const shift = 27 - index * 5;
    token += PUBLIC_STAMP_ALPHABET[(value >>> shift) & 31];
  }
  digest.fill(0);
  return `STAMP ${token}`;
}
