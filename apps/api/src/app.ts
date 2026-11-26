import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { authRouter } from "./routes/auth.routes";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get("/health", async (_req: Request, res: Response) => {
  const checks: { database: string; redis: string } = {
    database: "down",
    redis: "down",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "ok" : "error";
  } catch {
    checks.redis = "error";
  }

  const healthy = checks.database === "ok" && checks.redis === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "marketsphere-api",
    checks,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/auth", authRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled error:", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "Internal server error" });
});
