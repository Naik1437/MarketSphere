import { Worker } from "bullmq";
import { redis } from "./lib/redis";
import { FOUNDATION_QUEUE_NAME } from "./queues/foundation.queue";

const worker = new Worker(
  FOUNDATION_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] processed job ${job.id} (${job.name})`);
    return { ok: true };
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

worker.on("ready", () => {
  console.log(`[worker] listening on queue "${FOUNDATION_QUEUE_NAME}"`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  await worker.close();
  await redis.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
