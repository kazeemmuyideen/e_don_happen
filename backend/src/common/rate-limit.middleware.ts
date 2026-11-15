import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

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
    const windowSeconds = parseInt(
      this.config.get<string>('RATE_LIMIT_WINDOW_SECONDS') || '60',
      10,
    );
    const max = path.endsWith('/auth/send-otp')
      ? parseInt(this.config.get<string>('AUTH_RATE_LIMIT_MAX') || '20', 10)
      : parseInt(this.config.get<string>('RATE_LIMIT_MAX') || '300', 10);
    const key = `rate:${path.endsWith('/auth/send-otp') ? 'auth' : 'api'}:${req.ip}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader(
        'RateLimit-Remaining',
        String(Math.max(0, max - count)),
      );
      if (count > max) {
        res.setHeader('Retry-After', String(windowSeconds));
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Try again later.',
        });
        return;
      }
    } catch {
      this.logger.warn('Rate limiter unavailable; allowing request');
    }
    next();
  }
}
