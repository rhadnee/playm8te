import type { RequestHandler } from "express";
import { AuthService } from "../services/AuthService";
import { UnauthorizedError } from "../errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

export function requireAuth(authService: AuthService): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      next(new UnauthorizedError("Missing bearer token"));
      return;
    }
    const token = header.slice("Bearer ".length);
    try {
      const payload = authService.verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email };
      next();
    } catch (err) {
      next(err);
    }
  };
}
