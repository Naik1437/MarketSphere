import { Queue } from "bullmq";
import { redis } from "../lib/redis";

export const FOUNDATION_QUEUE_NAME = "marketsphere-foundation";

export const foundationQueue = new Queue(FOUNDATION_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
