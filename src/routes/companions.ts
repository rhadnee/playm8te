import { Router } from "express";
import { AuthService } from "../services/AuthService";
import { CompanionRepository } from "../db/repositories/CompanionRepository";
import { PersonalityService } from "../services/PersonalityService";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { CreateCompanionSchema } from "../schemas/requests";

export function companionRoutes(
  authService: AuthService,
  companions: CompanionRepository,
  personalityService: PersonalityService
): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.get("/", async (req, res, next) => {
    try {
      const list = await companions.listForOwner(req.user!.id);
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  router.post("/", validate({ body: CreateCompanionSchema }), async (req, res, next) => {
    try {
      const { name, avatarKey, voiceKey, personalityId, chessDifficulty } = req.body;
      personalityService.get(personalityId); // throws if unknown — fail fast before DB write
      const companion = await companions.create(
        req.user!.id,
        name,
        avatarKey,
        personalityId,
        voiceKey,
        chessDifficulty
      );
      res.status(201).json(companion);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
