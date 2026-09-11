import { Router } from "express";
import { AuthService } from "../services/AuthService";
import { validate } from "../middleware/validate";
import { RegisterSchema, LoginSchema, RefreshSchema } from "../schemas/requests";
import { authRateLimiter } from "../middleware/rateLimit";

export function authRoutes(authService: AuthService): Router {
  const router = Router();

  router.post("/register", authRateLimiter, validate({ body: RegisterSchema }), async (req, res, next) => {
    try {
      const { email, password, displayName } = req.body;
      const tokens = await authService.register(email, password, displayName);
      res.status(201).json(tokens);
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", authRateLimiter, validate({ body: LoginSchema }), async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const tokens = await authService.login(email, password);
      res.json(tokens);
    } catch (err) {
      next(err);
    }
  });

  router.post("/refresh", authRateLimiter, validate({ body: RefreshSchema }), async (req, res, next) => {
    try {
      const tokens = await authService.refresh(req.body.refreshToken);
      res.json(tokens);
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", validate({ body: RefreshSchema }), async (req, res, next) => {
    try {
      await authService.logout(req.body.refreshToken);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
