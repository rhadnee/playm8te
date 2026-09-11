import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { UserRepository } from "../db/repositories/UserRepository";
import { RefreshTokenRepository } from "../db/repositories/RefreshTokenRepository";
import { config } from "../config";
import { ConflictError, UnauthorizedError } from "../errors";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string };
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export class AuthService {
  constructor(private users: UserRepository, private refreshTokens: RefreshTokenRepository) {}

  async register(email: string, password: string, displayName: string): Promise<AuthTokens> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }
    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const user = await this.users.create(email, passwordHash, displayName);
    return this.issueTokens(user.id, user.email, user.display_name);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedError("Invalid email or password");
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new UnauthorizedError("Invalid email or password");
    return this.issueTokens(user.id, user.email, user.display_name);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const record = await this.refreshTokens.validate(refreshToken);
    if (!record) throw new UnauthorizedError("Invalid or expired refresh token");
    const user = await this.users.findById(record.userId);
    if (!user) throw new UnauthorizedError("Invalid or expired refresh token");

    await this.refreshTokens.revoke(refreshToken);
    return this.issueTokens(user.id, user.email, user.display_name);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(refreshToken);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, config.auth.jwtAccessSecret) as unknown as AccessTokenPayload;
    } catch {
      throw new UnauthorizedError("Invalid or expired access token");
    }
  }

  private async issueTokens(userId: string, email: string, displayName: string): Promise<AuthTokens> {
    // jti guarantees uniqueness even when two tokens for the same user are
    // issued within the same second — JWT `iat` has second precision, so
    // without a distinguishing claim, rapid re-auth (e.g. refresh rotation
    // in a fast test or a fast client retry) can otherwise mint a
    // byte-identical token.
    const jti = crypto.randomBytes(16).toString("hex");
    const accessToken = jwt.sign(
      { sub: userId, email, jti } as AccessTokenPayload & { jti: string },
      config.auth.jwtAccessSecret,
      { expiresIn: config.auth.accessTokenTtl } as jwt.SignOptions
    );

    const refreshToken = crypto.randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    await this.refreshTokens.store(userId, refreshToken, expiresAt);

    return { accessToken, refreshToken, user: { id: userId, email, displayName } };
  }
}
