import { HOLE_COUNT, type TokenStream } from "../types/transport.js";

export function assertTokenOnlyPayload(stream: TokenStream): void {
  if (!Array.isArray(stream.tokens)) {
    throw new Error("Token stream payload must include tokens array");
  }

  for (const token of stream.tokens) {
    if (!Number.isInteger(token) || token < 0 || token >= HOLE_COUNT) {
      throw new Error(`Invalid token id: ${token}`);
    }
  }
}

export function assertNoPlaintextField(payload: Record<string, unknown>): void {
  if ("plaintext" in payload || "message" in payload || "text" in payload) {
    throw new Error("Plaintext fields are forbidden in runtime payloads");
  }
}
