import { describe, expect, it } from "vitest";

import { parseTokenStream } from "../src/token/tokenStream.js";

describe("token stream parser", () => {
  it("accepts valid payload", () => {
    const payload = parseTokenStream({
      version: 1,
      conversationId: "conv_123",
      pageIndex: 0,
      tokens: [0, 1, 2],
      createdAtMs: Date.now()
    });

    expect(payload.tokens).toHaveLength(3);
  });

  it("rejects out-of-range hole ids", () => {
    expect(() =>
      parseTokenStream({
        version: 1,
        conversationId: "conv_123",
        pageIndex: 0,
        tokens: [0, 144],
        createdAtMs: Date.now()
      })
    ).toThrow();
  });
});
