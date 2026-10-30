/**
 * Errors a service throws when the caller asked for something wrong. The
 * HTTP router answers them with their status and message (http/router.ts);
 * any other error stays a 500.
 */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Input that fails validation: answered with 400. */
export class ValidationError extends ServiceError {
  constructor(message: string) {
    super(400, message);
    this.name = "ValidationError";
  }
}

/** A record that does not exist: answered with 404. */
export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super(404, message);
    this.name = "NotFoundError";
  }
}
