export class AppError extends Error {
  code: string;
  status: number;
  details?: any;
  constructor(code: string, message: string, status = 400, details?: any) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (m: string, d?: any) => new AppError('BAD_REQUEST', m, 400, d);
export const unauthorized = (m = 'Authentication required') => new AppError('UNAUTHORIZED', m, 401);
export const forbidden = (m = 'Insufficient permission') => new AppError('FORBIDDEN', m, 403);
export const notFound = (m = 'Resource not found') => new AppError('NOT_FOUND', m, 404);
export const conflict = (m: string, d?: any) => new AppError('CONFLICT', m, 409, d);
export const unprocessable = (m: string, d?: any) => new AppError('UNPROCESSABLE', m, 422, d);
export const quotaExceeded = (m: string) => new AppError('QUOTA_EXCEEDED', m, 429);

/** invariant helper used across feature modules */
export function invariant(cond: any, err: Error): asserts cond {
  if (!cond) throw err;
}
