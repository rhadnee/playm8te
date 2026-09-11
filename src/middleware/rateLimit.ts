import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { config } from "../config";

/** Protects register/login/refresh from brute-force and credential stuffing. */
export const authRateLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many auth attempts, try again later.", status: 429 },
});

/**
 * Rate-limits per authenticated user where available, falling back to IP
 * (via express-rate-limit's IPv6-safe helper — a raw req.ip fallback would
 * let IPv6 users bypass limits by rotating within their /64).
 */
function userOrIpKey(req: Request): string {
  return req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown");
}

/** Protects AI-invoking endpoints (direct cost per call, unlike most REST endpoints). */
export const aiRateLimiter = rateLimit({
  windowMs: config.rateLimit.aiWindowMs,
  max: config.rateLimit.aiMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { code: "RATE_LIMITED", message: "Too many AI requests, slow down.", status: 429 },
});

/** Protects match creation from spam. */
export const matchCreationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { code: "RATE_LIMITED", message: "Too many matches created, slow down.", status: 429 },
});
