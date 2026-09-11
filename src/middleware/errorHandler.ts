import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors";
import { config } from "../config";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `No route for ${req.method} ${req.path}`,
    status: 404,
    requestId: req.requestId,
  });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    req.log?.warn({ err: { code: err.code, message: err.message, details: err.details } }, "handled error");
    res.status(err.status).json({
      code: err.code,
      message: err.message,
      status: err.status,
      requestId: req.requestId,
      details: err.details,
    });
    return;
  }

  req.log?.error({ err }, "unhandled error");
  res.status(500).json({
    code: "INTERNAL_ERROR",
    message: config.nodeEnv === "production" ? "An unexpected error occurred" : (err as Error).message,
    status: 500,
    requestId: req.requestId,
  });
};
