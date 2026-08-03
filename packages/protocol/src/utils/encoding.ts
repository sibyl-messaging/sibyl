export function bytesToBase64(input: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let offset = 0; offset < input.length; offset += 0x8000) {
      binary += String.fromCharCode(...input.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }
  return Buffer.from(input).toString("base64");
}

export function base64ToBytes(input: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(input);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(input, "base64"));
}

export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToUtf8(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}
