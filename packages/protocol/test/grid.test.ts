import { describe, expect, it } from "vitest";

import {
  generateBlindInputMapping,
  resolveCodeToHoleId
} from "../src/grid/blindInputGrid.js";

describe("blind input grid mapping", () => {
  it("generates unique two-digit codes for active holes", () => {
    const holeIds = [0, 1, 2, 3, 4, 5, 6];
    const mapping = generateBlindInputMapping(holeIds);

    const codeValues = Object.values(mapping.codeByHoleId);
    expect(new Set(codeValues).size).toBe(codeValues.length);
  });

  it("rotates generation and prevents stale direct lookup assumptions", () => {
    const holeIds = [0, 7, 14, 21];
    const first = generateBlindInputMapping(holeIds, 0);
    const second = generateBlindInputMapping(holeIds, first.generation);

    expect(second.generation).toBe(first.generation + 1);

    let different = false;
    for (const holeId of holeIds) {
      const firstCode = first.codeByHoleId[String(holeId)];
      const secondCode = second.codeByHoleId[String(holeId)];
      if (firstCode !== secondCode) {
        different = true;
      }
    }

    expect(different).toBe(true);
  });

  it("resolves valid two-digit entries", () => {
    const holeIds = [3, 9, 27];
    const mapping = generateBlindInputMapping(holeIds);

    const [knownCode] = Object.keys(mapping.holeIdByCode);
    expect(resolveCodeToHoleId(mapping, knownCode!)).toBe(mapping.holeIdByCode[knownCode!]);
    expect(resolveCodeToHoleId(mapping, "A1")).toBeNull();
  });
});
