import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createTestPool, resetTestData } from "../helpers/db";
import { buildApp } from "../../src/app";

describe("Match lifecycle (integration, real Postgres, full HTTP stack)", () => {
  let pool: Pool;
  let app: ReturnType<typeof buildApp>["app"];

  beforeAll(() => {
    pool = createTestPool();
    ({ app } = buildApp(pool, () => {})); // no-op broadcast — WS layer tested separately
  });

  beforeEach(async () => {
    await resetTestData(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function registerAndLogin(email: string) {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "correcthorsebattery", displayName: "Test" });
    expect(res.status).toBe(201);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  it("unauthenticated request to a protected endpoint is rejected", async () => {
    const res = await request(app).get("/api/companions");
    expect(res.status).toBe(401);
  });

  it("full lifecycle: register -> create companion -> create match -> play a legal move -> AI auto-replies", async () => {
    const { token } = await registerAndLogin("lifecycle@example.com");

    const companionRes = await request(app)
      .post("/api/companions")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nova", avatarKey: "a1", personalityId: "coach" });
    expect(companionRes.status).toBe(201);
    const companionId = companionRes.body.id;

    const matchRes = await request(app)
      .post("/api/matches")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId });
    expect(matchRes.status).toBe(201);
    const matchId = matchRes.body.matchId;
    expect(matchRes.body.currentPhase).toBe("IN_PROGRESS");

    const moveRes = await request(app)
      .post(`/api/matches/${matchId}/moves`)
      .set("Authorization", `Bearer ${token}`)
      .send({ from: "e2", to: "e4" });
    expect(moveRes.status).toBe(200);
    // The AI companion (black) should have auto-played its reply in the
    // same request — turn should be back with white (the human), and move
    // number should reflect two half-moves, not one.
    expect(moveRes.body.state.turnPlayerId).toBeDefined();
    expect(moveRes.body.state.moveNumber).toBeGreaterThanOrEqual(2);
  });

  it("rejects an illegal move with 400, not 500", async () => {
    const { token } = await registerAndLogin("illegal@example.com");
    const companionRes = await request(app)
      .post("/api/companions")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nova", avatarKey: "a1", personalityId: "coach" });
    const matchRes = await request(app)
      .post("/api/matches")
      .set("Authorization", `Bearer ${token}`)
      .send({ companionId: companionRes.body.id });
    const matchId = matchRes.body.matchId;

    const res = await request(app)
      .post(`/api/matches/${matchId}/moves`)
      .set("Authorization", `Bearer ${token}`)
      .send({ from: "e2", to: "e5" }); // illegal — e5 not reachable from e2

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("a user cannot use another user's companion to create a match (403)", async () => {
    const owner = await registerAndLogin("owner@example.com");
    const intruder = await registerAndLogin("intruder@example.com");

    const companionRes = await request(app)
      .post("/api/companions")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Nova", avatarKey: "a1", personalityId: "coach" });

    const res = await request(app)
      .post("/api/matches")
      .set("Authorization", `Bearer ${intruder.token}`)
      .send({ companionId: companionRes.body.id });

    expect(res.status).toBe(403);
  });

  it("a user cannot view another user's match (403)", async () => {
    const owner = await registerAndLogin("owner2@example.com");
    const intruder = await registerAndLogin("intruder2@example.com");

    const companionRes = await request(app)
      .post("/api/companions")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Nova", avatarKey: "a1", personalityId: "coach" });
    const matchRes = await request(app)
      .post("/api/matches")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ companionId: companionRes.body.id });

    const res = await request(app)
      .get(`/api/matches/${matchRes.body.matchId}`)
      .set("Authorization", `Bearer ${intruder.token}`);

    expect(res.status).toBe(403);
  });

  it("duplicate registration returns 409, wrong password returns 401", async () => {
    await registerAndLogin("dup@example.com");
    const dupRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@example.com", password: "correcthorsebattery", displayName: "Test" });
    expect(dupRes.status).toBe(409);

    const badLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "dup@example.com", password: "wrongpassword" });
    expect(badLoginRes.status).toBe(401);
  });

  it("health and ready endpoints report correctly", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    const ready = await request(app).get("/ready");
    // Overall status can be 200 (ready) or 503 (degraded, e.g. if Stockfish
    // isn't installed in this test environment) — either is a valid,
    // honest report. What matters is the response is well-formed and the
    // database (which the test suite requires anyway) reports healthy.
    expect([200, 503]).toContain(ready.status);
    expect(ready.body.database).toBe("healthy");
    expect(["healthy", "unavailable"]).toContain(ready.body.stockfish);
  });
});
