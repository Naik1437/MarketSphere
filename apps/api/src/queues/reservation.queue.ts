import { Queue } from "bullmq";
import { redis } from "../lib/redis";

export const RESERVATION_EXPIRY_QUEUE = "marketsphere-reservation-expiry";

export const reservationExpiryQueue = new Queue(RESERVATION_EXPIRY_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

export async function scheduleReservationExpiry(
  reservationId: string,
  delayMs: number
) {
  await reservationExpiryQueue.add(
    "expire-reservation",
    { reservationId },
    {
      jobId: `expire-${reservationId}`,
      delay: Math.max(0, delayMs),
    }
  );
}
