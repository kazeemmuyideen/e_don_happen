import { RateLimitMiddleware } from './rate-limit.middleware.js';

describe('RateLimitMiddleware', () => {
  let redis: any;
  let config: any;
  let tokens: any;
  let middleware: RateLimitMiddleware;
  let req: any;
  let res: any;
  let next: any;

  const settings: Record<string, string> = {
    RATE_LIMIT_WINDOW_SECONDS: '60',
    RATE_LIMIT_MAX: '300',
    AUTH_RATE_LIMIT_MAX: '20',
    EXPENSIVE_RATE_LIMIT_MAX: '2',
  };

  beforeEach(() => {
    redis = { eval: vi.fn().mockResolvedValue([1, 60]) };
    config = {
      get: vi.fn((name: string) => settings[name]),
    };
    tokens = {
      verifyAccessToken: vi.fn(() => ({ sub: 'user-1' })),
    };
    middleware = new RateLimitMiddleware(redis, config, tokens);
    req = {
      originalUrl: '/api/reports',
      method: 'POST',
      ip: '203.0.113.1',
      socket: { remoteAddress: '203.0.113.1' },
      headers: {},
    };
    res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  it('exempts health checks and webhooks from rate limiting', async () => {
    await middleware.use(
      { ...req, originalUrl: '/api/health' } as any,
      res,
      next,
    );
    await middleware.use(
      { ...req, originalUrl: '/api/webhooks/payments' } as any,
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(2);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('uses a stricter user-and-IP bucket for expensive mutations', async () => {
    redis.eval.mockResolvedValue([3, 45]);
    req.headers.authorization = 'Bearer signed-token';

    await middleware.use(req, res, next);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'rate:expensive:203.0.113.1:user:user-1',
      60,
    );
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Limit', '2');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('keys anonymous traffic by IP', async () => {
    req.method = 'GET';
    req.originalUrl = '/api/reports?category=flood';

    await middleware.use(req, res, next);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'rate:api:203.0.113.1:anon',
      60,
    );
    expect(next).toHaveBeenCalled();
  });

  it('fails closed for authentication routes when Redis is unavailable', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    req.originalUrl = '/api/auth/send-otp';

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});
