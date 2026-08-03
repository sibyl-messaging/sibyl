import type { FastifyRequest } from "fastify";

export interface AuthContext {
  userId: string;
  username: string;
  deviceId: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  auth: AuthContext;
}

export interface RegisterUserInput {
  username: string;
  deviceId: string;
  signingPublicKey: string;
  x25519PublicKey: string;
}

export interface ConversationRecord {
  id: string;
  status: "pending" | "active";
}
