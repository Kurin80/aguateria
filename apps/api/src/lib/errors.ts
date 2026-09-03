export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function jsonError(code: string, message: string, status = 400, details?: unknown): AppError {
  return new AppError(code, message, status, details);
}
