import { Worker } from "bullmq";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { FOUNDATION_QUEUE_NAME } from "./queues/foundation.queue";
import { RESERVATION_EXPIRY_QUEUE } from "./queues/reservation.queue";
import { expireReservationById } from "./services/inventory.service";

const foundationWorker = new Worker(
  FOUNDATION_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] processed job ${job.id} (${job.name})`);
    return { ok: true };
  },
  { connection: redis, concurrency: 2 }
);

const reservationWorker = new Worker(
  RESERVATION_EXPIRY_QUEUE,
  async (job) => {
    const { reservationId } = job.data as { reservationId: string };
    const result = await expireReservationById(reservationId);
    console.log(`[worker] reservation-expiry ${reservationId}:`, result);
    return result;
  },
  { connection: redis, concurrency: 4 }
);

reservationWorker.on("failed", (job, err) => {
  console.error(`[worker] reservation job ${job?.id} failed:`, err.message);
});

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  await Promise.all([foundationWorker.close(), reservationWorker.close()]);
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
