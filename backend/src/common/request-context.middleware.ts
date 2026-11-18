import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incoming = req.header('x-request-id');
  const requestId =
    incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  next();
}
