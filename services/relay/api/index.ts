import type { IncomingMessage, ServerResponse } from "node:http";

import { createRelayRuntime } from "../src/app.js";

let runtimePromise: ReturnType<typeof createRelayRuntime> | null = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRelayRuntime();
  }
  return runtimePromise;
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
