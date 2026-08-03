import { randomUUID } from "node:crypto";

export function nextId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
