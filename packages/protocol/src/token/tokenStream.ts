import {
  MAX_TOKEN_STREAM_LENGTH,
  type TokenStream,
  tokenStreamSchema
} from "../types/transport.js";

export interface CreateTokenStreamInput {
  conversationId: string;
  pageIndex?: number;
  tokens: readonly number[];
  createdAtMs?: number;
}

export function createTokenStream(input: CreateTokenStreamInput): TokenStream {
  const stream: TokenStream = {
    version: 1,
    conversationId: input.conversationId,
    pageIndex: input.pageIndex ?? 0,
    tokens: [...input.tokens],
    createdAtMs: input.createdAtMs ?? Date.now()
  };

  return parseTokenStream(stream);
}

export function parseTokenStream(value: unknown): TokenStream {
  const parsed = tokenStreamSchema.parse(value);
  if (parsed.tokens.length > MAX_TOKEN_STREAM_LENGTH) {
    throw new Error(
      `Token stream exceeds max length (${MAX_TOKEN_STREAM_LENGTH})`
    );
  }
  return parsed;
}
