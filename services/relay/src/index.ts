import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { createRelayRuntime } from "./app.js";

let runtimePromise: ReturnType<typeof createRelayRuntime> | null = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRelayRuntime();
  }

  return runtimePromise;
}

async function bootstrap(): Promise<void> {
  const { app, env } = await getRuntime();

  await app.listen({
    host: env.HOST,
    port: env.PORT
  });

  app.log.info(`relay listening on ${env.HOST}:${env.PORT}`);
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    const { app } = await getRuntime();
    await app.ready();
    app.server.emit("request", request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runtime error";
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        error: "Relay bootstrap failed",
        message
      })
    );
  }
}

const argvPath = process.argv[1];
const isDirectRun =
  typeof argvPath === "string" &&
  argvPath.length > 0 &&
  import.meta.url === pathToFileURL(argvPath).href;

if (isDirectRun) {
  void bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
