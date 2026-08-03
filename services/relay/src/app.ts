import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import { config as loadDotEnv } from "dotenv";

import type { Env } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { ensureDatabaseSchema, createPgPool } from "./db/postgres.js";
import { registerRoutes } from "./http/routes.js";
import { AuthService } from "./services/authService.js";
import { ConversationService } from "./services/conversationService.js";
import { DirectoryService } from "./services/directoryService.js";
import { MemoryQueueService } from "./services/memoryQueueService.js";
import { PushService } from "./services/pushService.js";
import { QueueService, type QueueServiceLike } from "./services/queueService.js";
import { PostgresStampRelayRepository } from "./services/stampRepository.js";
import { StampService } from "./services/stampService.js";
import type { ServiceContainer } from "./types/services.js";
import { WsHub } from "./ws/hub.js";

export interface RelayRuntime {
  app: FastifyInstance;
  env: Env;
}

export async function createRelayRuntime(): Promise<RelayRuntime> {
  loadDotEnv();
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: "info"
    }
  });

  await app.register(cors, {
    origin: env.HELPER_WEB_ORIGIN
      ? env.HELPER_WEB_ORIGIN.split(",").map((origin) => origin.trim())
      : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"]
  });

  const pgPool = createPgPool(env.DATABASE_URL);
  await ensureDatabaseSchema(pgPool);

  let redis: Redis | null = null;
  let queueService: QueueServiceLike = new MemoryQueueService(pgPool);

  if (env.REDIS_URL) {
    const candidate = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true
    });

    try {
      await candidate.connect();
      await candidate.ping();
      redis = candidate;
      queueService = new QueueService(redis, pgPool);
      app.log.info("queue.backend=redis");
    } catch (error) {
      app.log.warn({ err: error }, "queue.redis_unavailable_falling_back_to_memory");
      candidate.disconnect();
      queueService = new MemoryQueueService(pgPool);
    }
  } else {
    app.log.warn("queue.redis_url_missing_using_memory_queue");
  }

  const stampRepository = new PostgresStampRelayRepository(pgPool);
  const services: ServiceContainer = {
    authService: new AuthService(pgPool, env),
    directoryService: new DirectoryService(pgPool),
    conversationService: new ConversationService(pgPool),
    queueService,
    pushService: new PushService(pgPool),
    stampService: new StampService(stampRepository)
  };

  const wsHub = new WsHub(app.server, services, app.log);
  await registerRoutes(app, services, wsHub);

  app.addHook("onClose", async () => {
    await wsHub.close();
    if (redis) {
      await redis.quit();
    }
    await pgPool.end();
  });

  return {
    app,
    env
  };
}
