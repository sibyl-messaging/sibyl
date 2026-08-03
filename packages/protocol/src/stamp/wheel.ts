import {
  STAMP_ALPHABET,
  STAMP_LENGTH,
  STAMP_MAX_SHARE_COUNT,
  STAMP_MIN_SHARE_COUNT
} from "./constants.js";
import { stampShareSchema, type StampShare } from "./types.js";

function parseWheelText(input: string, label: string): number[] {
  if (!new RegExp(`^[A-Z]{1,${STAMP_LENGTH}}$`).test(input)) {
    throw new Error(`${label} must contain 1-26 uppercase letters A-Z`);
  }
  return Array.from(input, (letter) => STAMP_ALPHABET.indexOf(letter));
}

function validateShareBundle(shares: readonly StampShare[]): StampShare[] {
  if (
    shares.length < STAMP_MIN_SHARE_COUNT ||
    shares.length > STAMP_MAX_SHARE_COUNT
  ) {
    throw new Error("A stamp bundle must contain 2-10 shares");
  }
  return shares.map((share) => stampShareSchema.parse(share));
}

export function encodeWithStampShare(
  plaintext: string,
  rawShare: StampShare
): string {
  const letters = parseWheelText(plaintext, "Plaintext");
  const share = stampShareSchema.parse(rawShare);
  return letters
    .map(
      (letter, index) =>
        STAMP_ALPHABET[
          (letter + share[index]!) % STAMP_ALPHABET.length
        ]!
    )
    .join("");
}

export function decodeWithStampShare(
  ciphertext: string,
  rawShare: StampShare
): string {
  const letters = parseWheelText(ciphertext, "Ciphertext");
  const share = stampShareSchema.parse(rawShare);
  return letters
    .map((letter, index) => {
      const decoded =
        (letter - share[index]! + STAMP_ALPHABET.length) %
        STAMP_ALPHABET.length;
      return STAMP_ALPHABET[decoded]!;
    })
    .join("");
}

export function encodeWithStampBundle(
  plaintext: string,
  rawShares: readonly StampShare[]
): string {
  const shares = validateShareBundle(rawShares);
  return shares.reduce(
    (current, share) => encodeWithStampShare(current, share),
    plaintext
  );
}

export function decodeWithStampBundle(
  ciphertext: string,
  rawShares: readonly StampShare[]
): string {
  const shares = validateShareBundle(rawShares);
  return [...shares]
    .reverse()
    .reduce(
      (current, share) => decodeWithStampShare(current, share),
      ciphertext
    );
}

export function formatStampShare(rawShare: StampShare): string {
  const share = stampShareSchema.parse(rawShare);
  return share.map((value) => value.toString().padStart(2, "0")).join(" ");
}

export function parseStampShare(input: string): StampShare {
  const pieces = input.trim().split(/\s+/);
  const values = pieces.map((piece) => {
    if (!/^\d{2}$/.test(piece)) {
      throw new Error("Each stamp value must use two digits from 00 to 25");
    }
    return Number(piece);
  });
  return stampShareSchema.parse(values);
}
