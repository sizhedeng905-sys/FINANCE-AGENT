import { HttpException } from '@nestjs/common';

import { LoginRateLimitService, LoginReservation } from '../src/auth/login-rate-limit.service';

describe('LoginRateLimitService', () => {
  it('atomically admits only the configured number of concurrent attempts', () => {
    const limiter = new LoginRateLimitService();
    const admitted: LoginReservation[] = [];
    let rejected = 0;

    for (let index = 0; index < 100; index += 1) {
      try {
        admitted.push(limiter.reserve('finance', '192.0.2.10'));
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        rejected += 1;
      }
    }

    expect(admitted).toHaveLength(5);
    expect(rejected).toBe(95);
    admitted.forEach((reservation) => limiter.release(reservation));
    expect(limiter.snapshot().globalInFlight).toBe(0);
  });

  it('removes expired buckets during bounded periodic cleanup', () => {
    const now = { value: Date.UTC(2026, 6, 14, 8) };
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now.value);
    try {
      const limiter = new LoginRateLimitService();
      for (let index = 0; index < 100; index += 1) {
        const reservation = limiter.reserve(`old-user-${index}`, `198.51.100.${index}`);
        limiter.success(reservation);
      }
      expect(limiter.snapshot().buckets).toBe(300);

      now.value += 31 * 60 * 1000;
      for (let index = 0; index < 256; index += 1) {
        const reservation = limiter.reserve(`new-user-${index}`, `203.0.113.${index}`);
        limiter.success(reservation);
      }
      expect(limiter.snapshot().buckets).toBeLessThanOrEqual(768);
    } finally {
      clock.mockRestore();
    }
  });
});
