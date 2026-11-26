import bcrypt from "bcryptjs";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "../lib/tokens";
import {
  authenticate,
  requireOwnership,
  requireRole,
} from "../middleware/auth";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
});

const loginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

function refreshExpiryDate(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + env.JWT_REFRESH_TTL_DAYS);
  return expires;
}

authRouter.post("/login", authLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload" });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email },
    include: { seller: { select: { id: true } } },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const sellerId = user.seller?.id ?? null;
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    sellerId,
  });

  const rawRefresh = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawRefresh);

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: refreshExpiryDate(),
      },
    }),
    prisma.auditRecord.create({
      data: {
        actorId: user.id,
        action: "AUTH_LOGIN",
        entityType: "User",
        entityId: user.id,
      },
    }),
  ]);

  res.status(200).json({
    accessToken,
    refreshToken: rawRefresh,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sellerId,
    },
  });
});

authRouter.post("/refresh", authLimiter, async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid refresh payload" });
    return;
  }

  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: { seller: { select: { id: true } } },
      },
    },
  });

  if (!existing) {
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }

  if (existing.revokedAt) {
    // Reuse detection: revoke all active refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.status(401).json({ error: "Refresh token revoked" });
    return;
  }

  if (existing.expiresAt < new Date() || !existing.user.isActive) {
    res.status(401).json({ error: "Refresh token expired" });
    return;
  }

  const rawNextRefresh = generateRefreshToken();
  const nextHash = hashRefreshToken(rawNextRefresh);

  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: nextHash,
        expiresAt: refreshExpiryDate(),
      },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenId: created.id,
      },
    });
  });

  const sellerId = existing.user.seller?.id ?? null;
  const accessToken = signAccessToken({
    sub: existing.user.id,
    email: existing.user.email,
    role: existing.user.role,
    sellerId,
  });

  res.status(200).json({
    accessToken,
    refreshToken: rawNextRefresh,
  });
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid logout payload" });
    return;
  }

  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  res.status(200).json({ ok: true });
});

authRouter.get("/me", authenticate, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      seller: { select: { id: true, businessName: true, status: true } },
    },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  res.status(200).json({ user });
});

authRouter.get(
  "/admin-check",
  authenticate,
  requireRole("ADMIN"),
  (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, scope: "ADMIN" });
  }
);

authRouter.get(
  "/warehouse-check",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "ADMIN"),
  (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, scope: "WAREHOUSE_OPERATOR" });
  }
);

authRouter.get(
  "/support-check",
  authenticate,
  requireRole("SUPPORT_AGENT", "ADMIN"),
  (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, scope: "SUPPORT_AGENT" });
  }
);

authRouter.get(
  "/sellers/:sellerId/scope",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  requireOwnership((req) => String(req.params.sellerId)),
  (req: Request, res: Response) => {
    res.status(200).json({ ok: true, sellerId: String(req.params.sellerId) });
  }
);

authRouter.get(
  "/customers/:customerId/scope",
  authenticate,
  requireRole("CUSTOMER", "ADMIN"),
  requireOwnership((req) => String(req.params.customerId)),
  (req: Request, res: Response) => {
    res.status(200).json({ ok: true, customerId: String(req.params.customerId) });
  }
);
