import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DeviceCredentials } from "../types/app";

const CREDENTIALS_KEY = "sibyl.credentials.v1";
const CALIBRATION_KEY = "sibyl.calibration.px_per_mm.v1";

export async function saveDeviceCredentials(
  credentials: DeviceCredentials
): Promise<void> {
  await AsyncStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function loadDeviceCredentials(): Promise<DeviceCredentials | null> {
  const raw = await AsyncStorage.getItem(CREDENTIALS_KEY);
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as DeviceCredentials;
}

export async function saveCalibrationPxPerMm(value: number): Promise<void> {
  await AsyncStorage.setItem(CALIBRATION_KEY, String(value));
}

export async function loadCalibrationPxPerMm(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(CALIBRATION_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
