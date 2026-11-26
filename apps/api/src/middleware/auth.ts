import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/tokens";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}

export function requireOwnership(
  resolveOwnerId: (req: Request) => string | null | undefined,
  allowAdmin = true
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (allowAdmin && req.user.role === "ADMIN") {
      next();
      return;
    }
    const targetOwnerId = resolveOwnerId(req);
    const actorOwnerId =
      req.user.role === "SELLER" ? req.user.sellerId : req.user.sub;

    if (!targetOwnerId || !actorOwnerId || targetOwnerId !== actorOwnerId) {
      res.status(403).json({ error: "Forbidden: resource ownership required" });
      return;
    }
    next();
  };
}
