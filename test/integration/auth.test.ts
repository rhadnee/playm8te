import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createTestPool, resetTestData } from "../helpers/db";
import { UserRepository } from "../../src/db/repositories/UserRepository";
import { RefreshTokenRepository } from "../../src/db/repositories/RefreshTokenRepository";
import { AuthService } from "../../src/services/AuthService";
import { ConflictError, UnauthorizedError } from "../../src/errors";

describe("AuthService (integration, real Postgres)", () => {
  let pool: Pool;
  let authService: AuthService;

  beforeAll(() => {
    pool = createTestPool();
    authService = new AuthService(new UserRepository(pool), new RefreshTokenRepository(pool));
  });

  beforeEach(async () => {
    await resetTestData(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("registers a new user and returns valid tokens", async () => {
    const result = await authService.register("test@example.com", "correcthorsebattery", "Test");
    expect(result.user.email).toBe("test@example.com");
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it("rejects duplicate email registration", async () => {
    await authService.register("dup@example.com", "correcthorsebattery", "Test");
    await expect(authService.register("dup@example.com", "anotherpassword", "Test2")).rejects.toThrow(
      ConflictError
    );
  });

  it("logs in with correct credentials", async () => {
    await authService.register("login@example.com", "correcthorsebattery", "Test");
    const result = await authService.login("login@example.com", "correcthorsebattery");
    expect(result.user.email).toBe("login@example.com");
  });

  it("rejects login with wrong password", async () => {
    await authService.register("wrongpw@example.com", "correcthorsebattery", "Test");
    await expect(authService.login("wrongpw@example.com", "wrongpassword")).rejects.toThrow(UnauthorizedError);
  });

  it("rejects login for a nonexistent email with the same error as wrong password (no user enumeration)", async () => {
    await expect(authService.login("doesnotexist@example.com", "whatever123")).rejects.toThrow(
      UnauthorizedError
    );
  });

  it("verifies a valid access token and rejects a garbage one", async () => {
    const result = await authService.register("verify@example.com", "correcthorsebattery", "Test");
    const payload = authService.verifyAccessToken(result.accessToken);
    expect(payload.email).toBe("verify@example.com");
    expect(() => authService.verifyAccessToken("not-a-real-jwt")).toThrow(UnauthorizedError);
  });

  it("refresh rotates the token — the old refresh token cannot be reused", async () => {
    const initial = await authService.register("refresh@example.com", "correcthorsebattery", "Test");
    const refreshed = await authService.refresh(initial.refreshToken);
    expect(refreshed.accessToken).not.toBe(initial.accessToken);
    // Old refresh token was revoked as part of rotation — reusing it must fail.
    await expect(authService.refresh(initial.refreshToken)).rejects.toThrow(UnauthorizedError);
  });

  it("logout revokes the refresh token", async () => {
    const result = await authService.register("logout@example.com", "correcthorsebattery", "Test");
    await authService.logout(result.refreshToken);
    await expect(authService.refresh(result.refreshToken)).rejects.toThrow(UnauthorizedError);
  });
});
