export const STAMP_PROTOCOL_VERSION = 2 as const;
export const STAMP_LENGTH = 26;
export const STAMP_MIN_SHARE_COUNT = 2;
export const STAMP_MAX_SHARE_COUNT = 10;
export const STAMP_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ" as const;

// 234 is the largest multiple of 26 that fits below 256. Bytes 234-255
// are rejected so every paper value has exactly the same probability.
export const STAMP_UNIFORM_BYTE_LIMIT = 234;

