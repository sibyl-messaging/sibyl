import { NativeModules } from "react-native";

interface SecurityRuntimeModule {
  setSecureScreen?: (enabled: boolean) => Promise<void>;
  setMaxBrightness?: () => Promise<void>;
  restoreBrightness?: () => Promise<void>;
}

const securityRuntime = NativeModules.SecurityRuntimeModule as
  | SecurityRuntimeModule
  | undefined;

export async function enableScreenSecurity(): Promise<void> {
  await securityRuntime?.setSecureScreen?.(true);
  await securityRuntime?.setMaxBrightness?.();
}

export async function restoreScreenSecurity(): Promise<void> {
  await securityRuntime?.restoreBrightness?.();
}
