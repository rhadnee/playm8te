import pino from "pino";
import { randomUUID } from "crypto";
import type { RequestHandler } from "express";
import { config } from "../config";

export const logger = pino({
  level: config.nodeEnv === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "apiKey",
    ],
    censor: "[REDACTED]",
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: pino.Logger;
    }
  }
}

export const requestContext: RequestHandler = (req, res, next) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader("x-request-id", requestId);
  next();
};
