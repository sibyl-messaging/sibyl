import type { HoleId } from "../types/transport.js";

const CODE_SPACE_SIZE = 100;

export interface BlindInputMapping {
  generation: number;
  createdAtMs: number;
  codeByHoleId: Record<string, string>;
  holeIdByCode: Record<string, HoleId>;
}

export function generateBlindInputMapping(
  activeHoleIds: readonly HoleId[],
  previousGeneration = 0
): BlindInputMapping {
  validateHoleIds(activeHoleIds);

  if (activeHoleIds.length > CODE_SPACE_SIZE) {
    throw new Error(
      `Cannot map ${activeHoleIds.length} holes to two-digit space of ${CODE_SPACE_SIZE}`
    );
  }

  const codes = buildCodePool();
  secureShuffle(codes);

  const codeByHoleId: Record<string, string> = {};
  const holeIdByCode: Record<string, HoleId> = {};

  for (let i = 0; i < activeHoleIds.length; i += 1) {
    const holeId = activeHoleIds[i];
    const code = codes[i];

    if (holeId === undefined || code === undefined) {
      throw new Error("Failed to generate code mapping");
    }

    codeByHoleId[String(holeId)] = code;
    holeIdByCode[code] = holeId;
  }

  return {
    generation: previousGeneration + 1,
    createdAtMs: Date.now(),
    codeByHoleId,
    holeIdByCode
  };
}

export function resolveCodeToHoleId(
  mapping: BlindInputMapping,
  code: string
): HoleId | null {
  const normalized = normalizeCode(code);
  if (normalized === null) {
    return null;
  }

  return mapping.holeIdByCode[normalized] ?? null;
}

export function normalizeCode(code: string): string | null {
  if (!/^\d{2}$/.test(code)) {
    return null;
  }
  return code;
}

function buildCodePool(): string[] {
  return Array.from({ length: CODE_SPACE_SIZE }, (_, value) =>
    value.toString().padStart(2, "0")
  );
}

function validateHoleIds(holeIds: readonly HoleId[]): void {
  const seen = new Set<number>();

  for (const holeId of holeIds) {
    if (!Number.isInteger(holeId) || holeId < 0 || holeId > 143) {
      throw new Error(`Invalid hole id ${holeId}`);
    }
    if (seen.has(holeId)) {
      throw new Error(`Duplicate hole id ${holeId}`);
    }
    seen.add(holeId);
  }
}

function secureShuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomIntInclusive(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

function randomIntInclusive(min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 0) {
    throw new Error("Invalid random range");
  }

  const maxUnbiased = Math.floor(0xffffffff / range) * range;

  while (true) {
    const value = randomUint32();
    if (value < maxUnbiased) {
      return min + (value % range);
    }
  }
}

function randomUint32(): number {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return (
    (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!
  ) >>> 0;
}
