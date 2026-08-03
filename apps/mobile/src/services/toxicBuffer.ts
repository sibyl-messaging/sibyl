import { NativeModules } from "react-native";
import { Buffer } from "buffer";

interface ToxicBufferModule {
  allocFromBase64?: (input: string) => Promise<string>;
  readAsBase64?: (handle: string) => Promise<string>;
  zeroizeAndFree?: (handle: string) => Promise<void>;
}

const toxicModule = NativeModules.ToxicBufferModule as ToxicBufferModule | undefined;

export async function withToxicSeed<T>(
  seedBase64: string,
  fn: (seedBytes: Uint8Array) => Promise<T>
): Promise<T> {
  if (toxicModule?.allocFromBase64 && toxicModule.readAsBase64) {
    const handle = await toxicModule.allocFromBase64(seedBase64);
    try {
      const view = await toxicModule.readAsBase64(handle);
      const bytes = Uint8Array.from(Buffer.from(view, "base64"));
      return await fn(bytes);
    } finally {
      await toxicModule.zeroizeAndFree?.(handle);
    }
  }

  const seed = Uint8Array.from(Buffer.from(seedBase64, "base64"));
  try {
    return await fn(seed);
  } finally {
    seed.fill(0);
  }
}
