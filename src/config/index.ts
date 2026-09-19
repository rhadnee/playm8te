import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Single source of truth for the dev-only fallback secrets — used both as
// the actual default value AND as what assertProductionConfig checks
// against. Keeping exactly one definition prevents the class of bug this
// previously had: a second, derived copy (INSECURE_DEV_SECRETS, built from
// config.auth.jwtAccessSecret) ended up just reflecting whatever secret
// was currently active, making the "is this the insecure fallback?" check
// tautologically true for every value — real secrets included. That bug
// meant assertProductionConfig rejected every production startup
// unconditionally, and was only caught by an actual production-boot smoke
// test, not by code review or the type system.
const DEV_FALLBACK_ACCESS_SECRET = "dev-only-insecure-access-secret-change-me";
const DEV_FALLBACK_REFRESH_SECRET = "dev-only-insecure-refresh-secret-change-me";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  frontendUrl: process.env.FRONTEND_URL ?? "",
  database: {
    url: process.env.DATABASE_URL ?? "",
  },
  ai: {
    provider: process.env.AI_PROVIDER ?? "anthropic",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "claude-sonnet-4-6",
  },
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? DEV_FALLBACK_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? DEV_FALLBACK_REFRESH_SECRET,
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  },
  rateLimit: {
    authWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? 15 * 60 * 1000),
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 10),
    aiWindowMs: Number(process.env.RATE_LIMIT_AI_WINDOW_MS ?? 60 * 1000),
    aiMax: Number(process.env.RATE_LIMIT_AI_MAX ?? 20),
  },
};

export function assertProductionConfig(): void {
  if (config.nodeEnv === "production") {
    required("DATABASE_URL");
    required("FRONTEND_URL");
    const access = required("JWT_ACCESS_SECRET");
    const refresh = required("JWT_REFRESH_SECRET");
    if (access === DEV_FALLBACK_ACCESS_SECRET || refresh === DEV_FALLBACK_REFRESH_SECRET) {
      throw new Error(
        "Refusing to start in production with default/dev JWT secrets. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET."
      );
    }
  }
}
