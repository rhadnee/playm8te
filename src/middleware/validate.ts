import type { RequestHandler } from "express";
import { ZodType } from "zod";
import { ValidationError } from "../errors";

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: Record<string, unknown> = {};

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) issues.body = result.error.flatten();
      else req.body = result.data;
    }
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) issues.params = result.error.flatten();
      else req.params = result.data as typeof req.params;
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) issues.query = result.error.flatten();
      else (req as any).query = result.data;
    }

    if (Object.keys(issues).length > 0) {
      next(new ValidationError(issues));
      return;
    }
    next();
  };
}
