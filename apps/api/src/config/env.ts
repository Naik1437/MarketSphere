import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      "postgresql://marketsphere:changeme_local_only@localhost:5432/marketsphere?schema=public"
    ),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z
    .string()
    .min(16)
    .default("local_dev_access_secret_change_me"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16)
    .default("local_dev_refresh_secret_change_me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export const env = envSchema.parse(process.env);
