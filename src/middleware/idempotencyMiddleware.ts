import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

import { prisma } from "../config/db.ts";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

const requestHash = (method: string, path: string, body: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify({ method, path, body: body ?? null }))
    .digest("hex");

export const requireIdempotencyKey = (operation: string): RequestHandler =>
  async (req, res, next) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ code: "UNAUTHORIZED", error: "Not authorized" });
      return;
    }
    const key = req.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) {
      res.status(400).json({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        error: "A valid Idempotency-Key header is required",
      });
      return;
    }

    const hash = requestHash(req.method, req.originalUrl, req.body);
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
    let requestId: string;

    try {
      const created = await prisma.idempotencyRequest.create({
        data: {
          actorId: actor.id,
          operation,
          idempotencyKey: key,
          requestHash: hash,
          expiresAt,
        },
      });
      requestId = created.id;
    } catch (error) {
      const existing = await prisma.idempotencyRequest.findUnique({
        where: {
          actorId_operation_idempotencyKey: {
            actorId: actor.id,
            operation,
            idempotencyKey: key,
          },
        },
      });
      if (!existing) throw error;
      if (existing.expiresAt <= new Date()) {
        await prisma.idempotencyRequest.delete({ where: { id: existing.id } });
        const recreated = await prisma.idempotencyRequest.create({
          data: {
            actorId: actor.id,
            operation,
            idempotencyKey: key,
            requestHash: hash,
            expiresAt,
          },
        });
        requestId = recreated.id;
      } else if (existing.requestHash !== hash) {
        res.status(409).json({
          code: "IDEMPOTENCY_KEY_REUSED",
          error: "Idempotency-Key was already used with a different request",
        });
        return;
      } else if (existing.status !== "PROCESSING" && existing.responseStatus && existing.responseBody) {
        res.setHeader("Idempotency-Replayed", "true");
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      } else {
        res.status(409).json({
          code: "REQUEST_IN_PROGRESS",
          error: "An identical request is already being processed",
        });
        return;
      }
    }

    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.once("finish", () => {
      const succeeded = res.statusCode >= 200 && res.statusCode < 300;
      void prisma.idempotencyRequest.update({
        where: { id: requestId },
        data: {
          status: succeeded ? "COMPLETED" : "FAILED",
          responseStatus: res.statusCode,
          responseBody:
            responseBody === undefined
              ? { message: succeeded ? "Completed" : "Failed" }
              : JSON.parse(JSON.stringify(responseBody)),
        },
      }).catch((updateError: unknown) => {
        console.error("Failed to finalize idempotency request", updateError);
      });
    });
    next();
  };
