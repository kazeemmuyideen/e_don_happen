import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split('?')[0];
    if (
      path === '/api/health' ||
      path === '/api/ready' ||
      path.startsWith('/api/webhooks/')
    ) {
      next();
      return;
    }

    const windowSeconds = this.numberSetting('RATE_LIMIT_WINDOW_SECONDS', 60);
    const authPath =
      path.endsWith('/auth/send-otp') ||
      path.endsWith('/auth/verify-otp') ||
      path.endsWith('/auth/refresh');
    const max = authPath
      ? this.numberSetting('AUTH_RATE_LIMIT_MAX', 20)
      : this.numberSetting('RATE_LIMIT_MAX', 300);
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `rate:${authPath ? 'auth' : 'api'}:${clientIp}`;

    try {
      const [count, ttl] = (await this.redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        windowSeconds,
      )) as [number, number];
      const resetAt = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
      res.setHeader('RateLimit-Reset', String(resetAt));
      if (count > max) {
        res.setHeader('Retry-After', String(Math.max(ttl, 1)));
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Try again later.',
        });
        return;
      }
    } catch {
      this.logger.warn('Rate limiter unavailable');
      if (authPath) {
        res.status(503).json({
          statusCode: 503,
          message: 'Authentication is temporarily unavailable.',
        });
        return;
      }
    }
    next();
  }

  private numberSetting(name: string, fallback: number) {
    const configured = Number(this.config.get<string>(name));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : fallback;
  }
}
