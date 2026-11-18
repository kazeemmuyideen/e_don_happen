import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { JwtTokenService } from '../modules/identity/services/jwt.service.js';

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
    private readonly tokens: JwtTokenService,
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
    const expensivePath = this.isExpensiveRoute(req.method, path);
    const tier = authPath ? 'auth' : expensivePath ? 'expensive' : 'api';
    const max = authPath
      ? this.numberSetting('AUTH_RATE_LIMIT_MAX', 20)
      : expensivePath
        ? this.numberSetting('EXPENSIVE_RATE_LIMIT_MAX', 30)
        : this.numberSetting('RATE_LIMIT_MAX', 300);
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = this.authenticatedUserId(req);
    const key = `rate:${tier}:${clientIp}:${userId ? `user:${userId}` : 'anon'}`;

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

  private isExpensiveRoute(method: string, path: string) {
    if (method !== 'POST') return false;
    return (
      path === '/api/sos' ||
      path === '/api/reports' ||
      /^\/api\/reports\/[^/]+\/evidence(?:\/upload)?$/.test(path) ||
      path === '/api/billing/payments/checkout'
    );
  }

  private authenticatedUserId(req: Request) {
    const user = (req as Request & { user?: { id?: unknown } }).user;
    if (typeof user?.id === 'string' && user.id) return user.id;
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return undefined;
    try {
      const payload = this.tokens.verifyAccessToken(token);
      return typeof payload.sub === 'string' && payload.sub
        ? payload.sub
        : undefined;
    } catch {
      return undefined;
    }
  }

  private numberSetting(name: string, fallback: number) {
    const configured = Number(this.config.get<string>(name));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : fallback;
  }
}
