import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** 与原版平台一致的统一错误体。 */
export class RuntimeRequestError extends Error {
  constructor(
    public code: 'INVALID_REQUEST' | 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_ERROR',
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }

  static invalid(message: string) {
    return new RuntimeRequestError('INVALID_REQUEST', 400, message);
  }
  static auth(message = '需要登录后才能访问该资源') {
    return new RuntimeRequestError('AUTHENTICATION_REQUIRED', 401, message);
  }
  static forbidden(message = '没有执行该操作的权限') {
    return new RuntimeRequestError('FORBIDDEN', 403, message);
  }
  static notFound(message = '资源不存在') {
    return new RuntimeRequestError('NOT_FOUND', 404, message);
  }
}

/** 每个响应附带 X-Request-Id: req_<uuid>（对齐原版）。 */
export function requestId(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Request-Id', `req_${randomUUID()}`);
  next();
}

/** Express 4 不自动捕获 async 异常，统一包装。 */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let code = 'INTERNAL_ERROR';
  let statusCode = 500;
  let message = '服务器内部错误';

  if (err instanceof RuntimeRequestError) {
    code = err.code;
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof SyntaxError && 'body' in (err as object)) {
    code = 'INVALID_REQUEST';
    statusCode = 400;
    message = '请求体不是合法 JSON';
  } else {
    console.error('[api] unhandled error:', err);
  }

  res.status(statusCode).json({
    error: 'RuntimeRequestError',
    code,
    statusCode,
    requestId: res.getHeader('X-Request-Id'),
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    message,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: 'RuntimeRequestError',
    code: 'NOT_FOUND',
    statusCode: 404,
    requestId: res.getHeader('X-Request-Id'),
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    message: `接口不存在: ${req.method} ${req.originalUrl}`,
  });
}
