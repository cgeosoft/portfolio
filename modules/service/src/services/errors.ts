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

/**
 * A failed call to a server the user configured (an LLM provider, a CLI). The
 * message carries the server's own text for the user. That text can repeat
 * part of the request, so the log gets `logMessage`, which has none of it.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly logMessage: string,
  ) {
    super(message);
    this.name = "UpstreamError";
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
