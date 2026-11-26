import crypto from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { authRouter } from "./routes/auth.routes";
import { cartRouter } from "./routes/cart.routes";
import { catalogRouter } from "./routes/catalog.routes";
import { inventoryRouter } from "./routes/inventory.routes";
import { ordersRouter } from "./routes/orders.routes";
import { postOrderRouter } from "./routes/post-order.routes";
import { sellersRouter } from "./routes/sellers.routes";
import { webhooksRouter } from "./routes/webhooks.routes";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

let totalRequests = 0;
app.use((req: Request, res: Response, next: NextFunction) => {
  totalRequests += 1;
  const reqId = req.header("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", reqId);
  const start = Date.now();
  res.on("finish", () => {
    if (env.NODE_ENV !== "test") {
      console.log(
        JSON.stringify({
          level: "info",
          reqId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        })
      );
    }
  });
  next();
});

app.get("/metrics", (_req: Request, res: Response) => {
  res.status(200).json({
    service: "marketsphere-api",
    totalRequests,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

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
app.use("/api/v1/sellers", sellersRouter);
app.use("/api/v1/products", catalogRouter);
app.use("/api/v1/inventory", inventoryRouter);
app.use("/api/v1/cart", cartRouter);
app.use("/api/v1/orders", ordersRouter);
app.use("/api/v1/webhooks", webhooksRouter);
app.use("/api/v1", postOrderRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled error:", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "Internal server error" });
});
