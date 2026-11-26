import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on port ${env.API_PORT}`);
});

async function shutdown(signal: string) {
  console.log(`[api] received ${signal}, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
