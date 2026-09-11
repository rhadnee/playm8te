import { z } from "zod";

export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80),
});

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const CreateCompanionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  avatarKey: z.string().trim().min(1).max(100),
  voiceKey: z.string().trim().max(100).optional(),
  personalityId: z.enum([
    "competitive",
    "funny",
    "chill",
    "coach",
    "strategic",
    "savage",
    "supportive",
  ]),
  chessDifficulty: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"]).optional(),
});

export const CreateMatchSchema = z.object({
  companionId: z.string().uuid(),
});

export const MatchIdParamSchema = z.object({
  matchId: z.string().uuid(),
});

export const SubmitMoveSchema = z.object({
  from: z.string().regex(/^[a-h][1-8]$/),
  to: z.string().regex(/^[a-h][1-8]$/),
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});

export const ChatMessageSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});
