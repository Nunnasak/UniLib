import type { ErrorRequestHandler, RequestHandler } from "express";

const defaultCodeByStatus: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
};

/** Normalizes legacy controller errors into one machine-readable response shape. */
export const normalizeErrorResponses: RequestHandler = (_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400 || typeof body !== "object" || body === null) {
      return originalJson(body);
    }
    const candidate = body as Record<string, unknown>;
    if (typeof candidate.error === "object" && candidate.error !== null) {
      return originalJson(body);
    }
    const message =
      typeof candidate.error === "string"
        ? candidate.error
        : typeof candidate.message === "string"
          ? candidate.message
          : "Request failed";
    const code =
      typeof candidate.code === "string"
        ? candidate.code
        : defaultCodeByStatus[res.statusCode] ?? "REQUEST_FAILED";
    return originalJson({ error: { code, message } });
  }) as typeof res.json;
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    code: "ENDPOINT_NOT_FOUND",
    error: `Cannot ${req.method} ${req.path}`,
  });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  console.error("Unhandled request error", error);
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({ code: "INTERNAL_ERROR", error: "Internal server error" });
};
