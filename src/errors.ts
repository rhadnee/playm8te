export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    // No manual prototype fixup needed on our ES2022 target — native class
    // extension of Error already sets the correct prototype chain. (A
    // previous version of this class called
    // `Object.setPrototypeOf(this, AppError.prototype)` here, which — since
    // subclass constructors call super() into this one — reset every
    // subclass instance's prototype back to AppError.prototype, silently
    // breaking `instanceof UnauthorizedError` / `instanceof ConflictError`
    // etc. for every subclass. Caught by the auth integration tests.)
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super("VALIDATION_ERROR", "Request failed validation", 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}
