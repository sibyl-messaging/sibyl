export function nextDeviceId(): string {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nextEnvelopeId(): string {
  return `env_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
