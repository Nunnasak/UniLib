import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { prisma } from "../config/db.ts";
import { getRequiredEnv } from "../config/env.ts";

const hasUserId = (payload: string | JwtPayload): payload is JwtPayload & { id: string } =>
  typeof payload !== "string" && typeof payload.id === "string";

export const authMiddleware: RequestHandler = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const cookieToken =
    typeof req.cookies?.jwt === "string" ? req.cookies.jwt : undefined;
  const token = bearerToken ?? cookieToken;

  if (!token) {
    res.status(401).json({ error: "Not authorized, no token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token, getRequiredEnv("JWT_SECRET"));

    if (!hasUserId(decoded)) {
      res.status(401).json({ error: "Not authorized, invalid token payload" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      res.status(401).json({ error: "User no longer exists" });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Not authorized, token failed" });
  }
};
