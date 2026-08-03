import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { utf8ToBytes } from "@sibyl/protocol";
import { Buffer } from "buffer";
import sss from "shamirs-secret-sharing";

import { withToxicSeed } from "./toxicBuffer";

const GLYPH_SLOT_COUNT = 28;

export function generateMasterSeedShares(): {
  seedBase64: string;
  shares: [string, string, string];
} {
  const seedBytes = randomBytes(32);
  const sharesRaw = sss.split(seedBytes, {
    shares: 3,
    threshold: 3
  });

  const shares = sharesRaw.map((value: Uint8Array) => Buffer.from(value).toString("base64")) as [
    string,
    string,
    string
  ];

  const seedBase64 = Buffer.from(seedBytes).toString("base64");
  seedBytes.fill(0);
  return { seedBase64, shares };
}

export async function reconstructSeedFromShares(
  shares: [string, string, string]
): Promise<string> {
  const shareBuffers = shares.map((share) => Buffer.from(share, "base64"));
  const seedBytes = sss.combine(shareBuffers);
  const seedBase64 = Buffer.from(seedBytes).toString("base64");

  seedBytes.fill(0);
  for (const share of shareBuffers) {
    share.fill(0);
  }

  return seedBase64;
}

export async function deriveConversationHoleMap(
  seedBase64: string,
  conversationId: string
): Promise<number[]> {
  return withToxicSeed(seedBase64, async (seedBytes) => {
    const info = utf8ToBytes(`sibyl:sheet:${conversationId}`);
    const expanded = hkdf(sha256, seedBytes, undefined, info, 256);

    const unique = new Set<number>();
    let index = 0;
    while (unique.size < GLYPH_SLOT_COUNT && index < expanded.length) {
      unique.add(expanded[index]! % 144);
      index += 1;
    }

    if (unique.size < GLYPH_SLOT_COUNT) {
      throw new Error("Failed to derive hole map");
    }

    return [...unique];
  });
}

export function makeShareQrPayload(share: string): string {
  return Buffer.from(utf8ToBytes(share)).toString("utf8");
}
