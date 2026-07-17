import { ConfigService } from '@nestjs/config';

import { RequestRateLimitMiddleware } from '../src/common/middleware/request-rate-limit.middleware';

describe('HTTP security middleware', () => {
  it('returns the unified 429 envelope after the fixed-window limit', async () => {
    const config = {
      get: (key: string) => key === 'requestRateLimit.max' ? 2 : key === 'requestRateLimit.store' ? 'memory' : 60000
    } as ConfigService;
    const redis = { fixedWindowRateLimit: jest.fn() } as any;
    const middleware = new RequestRateLimitMiddleware(config, redis);
    const request = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      requestId: 'request-rate-limit-test'
    } as any;
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    } as any;
    const next = jest.fn();

    await middleware.use(request, response, next);
    await middleware.use(request, response, next);
    await middleware.use(request, response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      code: 42901,
      message: '请求过于频繁，请稍后重试',
      data: { requestId: 'request-rate-limit-test', retryAfterSeconds: expect.any(Number) }
    });
  });

  it('uses the shared Redis counter when configured', async () => {
    const config = {
      get: (key: string) => key === 'requestRateLimit.max' ? 10 : key === 'requestRateLimit.store' ? 'redis' : 60000
    } as ConfigService;
    const redis = { fixedWindowRateLimit: jest.fn(async () => ({ count: 11, ttlMs: 2500 })) } as any;
    const middleware = new RequestRateLimitMiddleware(config, redis);
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();

    await middleware.use({ ip: '10.0.0.2', socket: {}, requestId: 'redis-rate-test' } as any, response, next);

    expect(redis.fixedWindowRateLimit).toHaveBeenCalledWith('10.0.0.2', 60000);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});
