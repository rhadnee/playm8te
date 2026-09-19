import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// config.ts reads environment variables at module-load time, so each test
// needs a fresh module instance per env combination. vi.resetModules()
// clears vitest's module cache so the next dynamic import re-evaluates the
// module from scratch — this matters here specifically because the bug
// this file regression-tests was caused by state computed once at load
// time becoming stale/self-referential.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import("../../src/config/index")) as typeof import("../../src/config/index");
}

describe("config.assertProductionConfig", () => {
  it(
    "REGRESSION: a real, properly-configured secret must NOT be rejected as the dev fallback " +
      "(previous bug: the fallback-detection array was derived from the currently-active secret " +
      "itself, making the check tautologically true for every value, including real secrets)",
    async () => {
      const { assertProductionConfig } = await loadConfigWithEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://real",
        ANTHROPIC_API_KEY: "sk-ant-real",
        FRONTEND_URL: "https://real-frontend.example.com",
        JWT_ACCESS_SECRET: "a-real-randomly-generated-secret-value-1",
        JWT_REFRESH_SECRET: "a-different-real-randomly-generated-secret-2",
      });
      expect(() => assertProductionConfig()).not.toThrow();
    }
  );

  it("rejects the actual dev fallback access secret in production", async () => {
    const { assertProductionConfig } = await loadConfigWithEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://real",
      ANTHROPIC_API_KEY: "sk-ant-real",
      FRONTEND_URL: "https://real-frontend.example.com",
      JWT_ACCESS_SECRET: "dev-only-insecure-access-secret-change-me",
      JWT_REFRESH_SECRET: "a-real-refresh-secret",
    });
    expect(() => assertProductionConfig()).toThrow(/default\/dev JWT secrets/i);
  });

  it("rejects the actual dev fallback refresh secret in production", async () => {
    const { assertProductionConfig } = await loadConfigWithEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://real",
      ANTHROPIC_API_KEY: "sk-ant-real",
      FRONTEND_URL: "https://real-frontend.example.com",
      JWT_ACCESS_SECRET: "a-real-access-secret",
      JWT_REFRESH_SECRET: "dev-only-insecure-refresh-secret-change-me",
    });
    expect(() => assertProductionConfig()).toThrow();
  });

  it("allows production startup without Anthropic when other required config is present", async () => {
    const { assertProductionConfig } = await loadConfigWithEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://real",
      ANTHROPIC_API_KEY: undefined,
      FRONTEND_URL: "https://real-frontend.example.com",
      JWT_ACCESS_SECRET: "a-real-access-secret",
      JWT_REFRESH_SECRET: "a-real-refresh-secret",
    });
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("requires FRONTEND_URL in production", async () => {
    const { assertProductionConfig } = await loadConfigWithEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://real",
      ANTHROPIC_API_KEY: "sk-ant-real",
      FRONTEND_URL: undefined,
      JWT_ACCESS_SECRET: "a-real-access-secret",
      JWT_REFRESH_SECRET: "a-real-refresh-secret",
    });
    expect(() => assertProductionConfig()).toThrow(/FRONTEND_URL/);
  });

  it("does not validate anything in development", async () => {
    const { assertProductionConfig } = await loadConfigWithEnv({
      NODE_ENV: "development",
    });
    expect(() => assertProductionConfig()).not.toThrow();
  });
});
