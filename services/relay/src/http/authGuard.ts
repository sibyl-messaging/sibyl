import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthContext } from "../types/domain.js";
import type { ServiceContainer } from "../types/services.js";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  services: ServiceContainer
): Promise<AuthContext | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Missing Bearer token" });
    return null;
  }

  const token = authHeader.slice("Bearer ".length);
  const auth = await services.authService.verifyAccessToken(token);
  request.auth = auth;
  return auth;
}
