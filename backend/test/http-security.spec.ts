import { ConfigService } from '@nestjs/config';

import { RequestRateLimitMiddleware } from '../src/common/middleware/request-rate-limit.middleware';

describe('HTTP security middleware', () => {
  it('returns the unified 429 envelope after the fixed-window limit', () => {
    const config = { get: (key: string) => key === 'requestRateLimit.max' ? 2 : 60000 } as ConfigService;
    const middleware = new RequestRateLimitMiddleware(config);
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

    middleware.use(request, response, next);
    middleware.use(request, response, next);
    middleware.use(request, response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      code: 42901,
      message: '请求过于频繁，请稍后重试',
      data: { requestId: 'request-rate-limit-test', retryAfterSeconds: expect.any(Number) }
    });
  });
});
