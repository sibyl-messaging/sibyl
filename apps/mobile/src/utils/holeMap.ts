export const GLYPH_ORDER = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  " ",
  "."
] as const;

export const ACTIVE_HOLE_IDS = [
  0, 5, 10, 15, 21, 26, 31, 37, 42, 47, 53, 58, 63, 69, 74, 79, 85, 90, 95,
  101, 106, 111, 117, 122, 127, 133, 138, 143
] as const;

export type SupportedGlyph = (typeof GLYPH_ORDER)[number];

export const GLYPH_TO_HOLE_ID: Record<SupportedGlyph, number> = GLYPH_ORDER.reduce(
  (acc, glyph, index) => {
    acc[glyph] = ACTIVE_HOLE_IDS[index]!;
    return acc;
  },
  {} as Record<SupportedGlyph, number>
);

export const HOLE_ID_TO_GLYPH: Record<number, SupportedGlyph> = ACTIVE_HOLE_IDS.reduce(
  (acc, holeId, index) => {
    acc[holeId] = GLYPH_ORDER[index]!;
    return acc;
  },
  {} as Record<number, SupportedGlyph>
);

const supportedGlyphSet = new Set<string>(GLYPH_ORDER);

export function normalizeDemoText(value: string): string {
  return value
    .toUpperCase()
    .split("")
    .map((glyph) => (supportedGlyphSet.has(glyph) ? glyph : " "))
    .join("");
}

export function textToHoleTokens(value: string): number[] {
  const normalized = normalizeDemoText(value);
  const tokens: number[] = [];

  for (const glyph of normalized) {
    const holeId = GLYPH_TO_HOLE_ID[glyph as SupportedGlyph];
    if (holeId !== undefined) {
      tokens.push(holeId);
    }
  }

  return tokens;
}
