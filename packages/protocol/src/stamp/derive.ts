import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { utf8ToBytes } from "../utils/encoding.js";
import {
  STAMP_LENGTH,
  STAMP_UNIFORM_BYTE_LIMIT
} from "./constants.js";
import { encodeStampShareContext } from "./canonical.js";
import {
  stampShareSchema,
  type StampShare,
  type StampShareContext
} from "./types.js";

const MIN_EXPORTER_SECRET_BYTES = 32;
const DERIVATION_BLOCK_BYTES = 64;
const MAX_DERIVATION_ROUNDS = 256;
const DERIVATION_DOMAIN = utf8ToBytes("sibyl/stamp-share/v2");

function concatenateBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeRound(round: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, round, false);
  return output;
}

export function mapUniformBytesToStampValues(
  bytes: Uint8Array,
  maximumValues = STAMP_LENGTH
): number[] {
  if (!Number.isInteger(maximumValues) || maximumValues < 0) {
    throw new Error("maximumValues must be a non-negative integer");
  }
  if (maximumValues === 0) {
    return [];
  }

  const values: number[] = [];
  for (const byte of bytes) {
    if (byte < STAMP_UNIFORM_BYTE_LIMIT) {
      values.push(byte % 26);
      if (values.length === maximumValues) {
        break;
      }
    }
  }
  return values;
}

/**
 * Converts one high-entropy exporter secret from an authenticated helper-pair
 * session into the matching 26 paper values shown independently at each end.
 */
export function deriveStampShare(
  exporterSecret: Uint8Array,
  context: StampShareContext
): StampShare {
  if (exporterSecret.length < MIN_EXPORTER_SECRET_BYTES) {
    throw new Error("Exporter secret must contain at least 32 bytes");
  }

  const contextBytes = encodeStampShareContext(context);
  const salt = sha256(contextBytes);
  const values: number[] = [];

  for (
    let round = 0;
    round < MAX_DERIVATION_ROUNDS && values.length < STAMP_LENGTH;
    round += 1
  ) {
    const info = concatenateBytes(
      DERIVATION_DOMAIN,
      contextBytes,
      encodeRound(round)
    );
    const block = hkdf(
      sha256,
      exporterSecret,
      salt,
      info,
      DERIVATION_BLOCK_BYTES
    );
    values.push(
      ...mapUniformBytesToStampValues(block, STAMP_LENGTH - values.length)
    );
    block.fill(0);
  }

  if (values.length !== STAMP_LENGTH) {
    throw new Error("Unable to derive a complete stamp share");
  }

  return stampShareSchema.parse(values);
}
