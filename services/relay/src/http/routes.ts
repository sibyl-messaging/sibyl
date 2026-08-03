import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { HttpError } from "../utils/httpError.js";
import type { ServiceContainer, WsHubLike } from "../types/services.js";
import { requireAuth } from "./authGuard.js";
import { registerStampRoutes } from "./stampRoutes.js";

type RegisterBody = {
  username: string;
  deviceId: string;
  signingPublicKey: string;
  x25519PublicKey: string;
};

type ChallengeBody = {
  username: string;
  deviceId: string;
};

type VerifyBody = {
  challengeId: string;
  signature: string;
};

type ConversationBody = {
  recipientUsername: string;
};

type PushTokenBody = {
  platform: "ios" | "android";
  pushToken: string;
};

type LookupQuery = {
  username: string;
};

const registerSchema = z.object({
  username: z.string().min(3).max(24),
  deviceId: z.string().min(3),
  signingPublicKey: z.string().min(1),
  x25519PublicKey: z.string().min(1)
});

const challengeSchema = z.object({
  username: z.string().min(3).max(24),
  deviceId: z.string().min(3)
});

const verifySchema = z.object({
  challengeId: z.string().min(1),
  signature: z.string().min(1)
});

const conversationSchema = z.object({
  recipientUsername: z.string().min(3).max(24)
});

const pushTokenSchema = z.object({
  platform: z.enum(["ios", "android"]),
  pushToken: z.string().min(8)
});

const lookupSchema = z.object({
  username: z.string().min(3).max(24)
});

const conversationParamsSchema = z.object({
  conversationId: z.string().min(1)
});

function requireString(value: string | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `Missing ${field}`);
  }
  return value;
}

function parseRegisterBody(input: unknown): RegisterBody {
  const parsed = registerSchema.parse(input);
  return {
    username: requireString(parsed.username, "username"),
    deviceId: requireString(parsed.deviceId, "deviceId"),
    signingPublicKey: requireString(parsed.signingPublicKey, "signingPublicKey"),
    x25519PublicKey: requireString(parsed.x25519PublicKey, "x25519PublicKey")
  };
}

function parseChallengeBody(input: unknown): ChallengeBody {
  const parsed = challengeSchema.parse(input);
  return {
    username: requireString(parsed.username, "username"),
    deviceId: requireString(parsed.deviceId, "deviceId")
  };
}

function parseVerifyBody(input: unknown): VerifyBody {
  const parsed = verifySchema.parse(input);
  return {
    challengeId: requireString(parsed.challengeId, "challengeId"),
    signature: requireString(parsed.signature, "signature")
  };
}

function parseConversationBody(input: unknown): ConversationBody {
  const parsed = conversationSchema.parse(input);
  return {
    recipientUsername: requireString(parsed.recipientUsername, "recipientUsername")
  };
}

function parsePushTokenBody(input: unknown): PushTokenBody {
  const parsed = pushTokenSchema.parse(input);
  const platform = parsed.platform;
  if (platform !== "ios" && platform !== "android") {
    throw new HttpError(400, "Invalid platform");
  }
  return {
    platform,
    pushToken: requireString(parsed.pushToken, "pushToken")
  };
}

function parseLookupQuery(input: unknown): LookupQuery {
  const parsed = lookupSchema.parse(input);
  return {
    username: requireString(parsed.username, "username")
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  services: ServiceContainer,
  wsHub: WsHubLike
): Promise<void> {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({
        error: error.message
      });
      return;
    }

    if (error instanceof z.ZodError) {
      reply.status(400).send({
        error: "Invalid request",
        issues: error.issues
      });
      return;
    }

    reply.status(500).send({
      error: "Internal server error"
    });
  });

  app.post("/v1/users/register", async (request) => {
    const body = parseRegisterBody(request.body);
    const result = await services.authService.registerUser(body);
    return {
      userId: result.userId,
      username: body.username.trim().toLowerCase(),
      deviceId: body.deviceId
    };
  });

  app.post("/v1/auth/challenge", async (request) => {
    const body = parseChallengeBody(request.body);
    return services.authService.createChallenge(body.username, body.deviceId);
  });

  app.post("/v1/auth/verify", async (request) => {
    const body = parseVerifyBody(request.body);
    return services.authService.verifyChallenge(body);
  });

  app.get("/v1/users/lookup", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }

    const query = parseLookupQuery(request.query);

    const user = await services.directoryService.lookupByUsername(query.username);
    return {
      id: user.id,
      username: user.username,
      status: user.status,
      devices: user.devices
    };
  });

  app.post("/v1/conversations", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }

    const body = parseConversationBody(request.body);
    const conversation = await services.conversationService.createConversation({
      creatorUserId: auth.userId,
      creatorDeviceId: auth.deviceId,
      recipientUsername: body.recipientUsername
    });

    if (conversation.status === "pending") {
      wsHub.sendToUser(conversation.recipientUserId, "conversation.invite", {
        conversationId: conversation.conversationId,
        fromUsername: auth.username
      });
    }

    return {
      conversationId: conversation.conversationId,
      status: conversation.status
    };
  });

  app.get("/v1/conversations/invites", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    return {
      invites: await services.conversationService.getPendingInvitesForUser(
        auth.userId
      )
    };
  });

  app.get("/v1/conversations/:conversationId", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const params = conversationParamsSchema.parse(request.params);
    return services.conversationService.getConversationStatus(
      params.conversationId,
      auth.userId
    );
  });

  app.post("/v1/conversations/:conversationId/accept", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }
    const params = conversationParamsSchema.parse(request.params);
    return services.conversationService.acceptConversation(
      params.conversationId,
      auth.userId
    );
  });

  app.post("/v1/devices/push-token", async (request, reply) => {
    const auth = await requireAuth(request, reply, services);
    if (!auth) {
      return reply;
    }

    const body = parsePushTokenBody(request.body);
    await services.pushService.updatePushToken(
      auth.deviceId,
      body.platform,
      body.pushToken
    );

    return {
      ok: true
    };
  });

  await registerStampRoutes(app, services, wsHub);

  app.get("/", async () => ({
    ok: true,
    service: "sibyl-relay"
  }));

  app.get("/health", async () => ({ ok: true }));
}
