import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';

import { AuthController } from '../src/auth/auth.controller';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import {
  DEVELOPMENT_CSRF_COOKIE,
  DEVELOPMENT_SESSION_COOKIE,
  parseCookieHeaderDetails,
  PRODUCTION_CSRF_COOKIE,
  PRODUCTION_SESSION_COOKIE
} from '../src/common/utils/auth-cookies';

function guardHarness(options: {
  nodeEnv?: 'development' | 'production';
  cookie?: string;
  method?: string;
  csrfHeader?: string;
  authorization?: string;
  payload?: Record<string, unknown>;
}) {
  const request: any = {
    method: options.method ?? 'GET',
    headers: {
      cookie: options.cookie,
      authorization: options.authorization,
      ...(options.csrfHeader ? { 'x-csrf-token': options.csrfHeader } : {})
    }
  };
  const response = { clearCookie: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
  } as unknown as ExecutionContext;
  const jwt = {
    verifyAsync: jest.fn(async () => options.payload ?? { sub: 'boss_1', ver: 3, typ: 'access' })
  } as unknown as JwtService;
  const config = {
    get: jest.fn((key: string) => key === 'nodeEnv' ? options.nodeEnv ?? 'development' : undefined),
    getOrThrow: jest.fn((key: string) => ({
      jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
      jwtIssuer: 'finance-agent',
      jwtAudience: 'finance-agent-api'
    })[key])
  } as unknown as ConfigService;
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        id: 'boss_1',
        username: 'boss',
        name: 'Boss',
        role: UserRole.boss,
        department: '',
        phone: null,
        status: UserStatus.active,
        tokenVersion: 3
      }))
    }
  };
  return { guard: new JwtAuthGuard(jwt, config, prisma as any), request, response, context, jwt };
}

describe('authentication boundary hardening', () => {
  it('detects duplicate cookie names without letting the last value win', () => {
    const parsed = parseCookieHeaderDetails('a=first; a=second; b=value');
    expect(parsed.cookies).toEqual({ a: 'first', b: 'value' });
    expect([...parsed.names]).toEqual(['a', 'b']);
    expect([...parsed.duplicateNames]).toEqual(['a']);
  });

  it('detects empty and malformed duplicate values before decoding', () => {
    const parsed = parseCookieHeaderDetails('a=%E0%A4%A; a=valid; b=; b=value');
    expect(parsed.cookies).toEqual({ a: 'valid', b: 'value' });
    expect([...parsed.duplicateNames]).toEqual(['a', 'b']);
  });

  it.each([
    [`${DEVELOPMENT_SESSION_COOKIE}=dev`, 'development cookie in production'],
    [`${DEVELOPMENT_SESSION_COOKIE}=%E0%A4%A`, 'malformed development cookie in production'],
    [`${PRODUCTION_SESSION_COOKIE}=prod; ${DEVELOPMENT_SESSION_COOKIE}=dev`, 'mixed cookie families'],
    [`${PRODUCTION_SESSION_COOKIE}=first; ${PRODUCTION_SESSION_COOKIE}=second`, 'duplicate host cookie'],
    [`${PRODUCTION_SESSION_COOKIE}=; ${PRODUCTION_SESSION_COOKIE}=second`, 'empty duplicate host cookie']
  ])('rejects and clears %s (%s)', async (cookie) => {
    const harness = guardHarness({ nodeEnv: 'production', cookie });
    await expect(harness.guard.canActivate(harness.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.response.clearCookie).toHaveBeenCalled();
    expect((harness.jwt.verifyAsync as jest.Mock)).not.toHaveBeenCalled();
  });

  it('rejects production cookies in development', async () => {
    const harness = guardHarness({ nodeEnv: 'development', cookie: `${PRODUCTION_SESSION_COOKIE}=prod` });
    await expect(harness.guard.canActivate(harness.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.response.clearCookie).toHaveBeenCalledWith(
      PRODUCTION_SESSION_COOKIE,
      expect.objectContaining({ secure: true, path: '/' })
    );
  });

  it('requires the environment-specific CSRF token and exact match', async () => {
    const harness = guardHarness({
      nodeEnv: 'production',
      method: 'POST',
      cookie: `${PRODUCTION_SESSION_COOKIE}=prod; ${PRODUCTION_CSRF_COOKIE}=cookie-token`,
      csrfHeader: 'different-token'
    });
    await expect(harness.guard.canActivate(harness.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect((harness.jwt.verifyAsync as jest.Mock)).not.toHaveBeenCalled();
  });

  it('locks JWT verification to access purpose, HS256, issuer, and audience', async () => {
    const harness = guardHarness({
      nodeEnv: 'production',
      cookie: `${PRODUCTION_SESSION_COOKIE}=prod`,
      method: 'GET'
    });
    await expect(harness.guard.canActivate(harness.context)).resolves.toBe(true);
    expect(harness.jwt.verifyAsync).toHaveBeenCalledWith('prod', expect.objectContaining({
      algorithms: ['HS256'],
      issuer: 'finance-agent',
      audience: 'finance-agent-api'
    }));
    expect(harness.request.user).toMatchObject({ id: 'boss_1', role: UserRole.boss });

    const stepUp = guardHarness({
      authorization: 'Bearer step-up-token',
      payload: { sub: 'boss_1', ver: 3, typ: 'step_up' }
    });
    await expect(stepUp.guard.canActivate(stepUp.context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sets only __Host cookies in production and clears the development family', async () => {
    const authService = {
      login: jest.fn(async () => ({ accessToken: 'access-token', user: { id: 'boss_1' } }))
    };
    const config = { get: jest.fn(() => 'production') } as unknown as ConfigService;
    const controller = new AuthController(authService as any, config);
    const response = { cookie: jest.fn(), clearCookie: jest.fn() } as any;
    await controller.login(
      { username: 'boss', password: '123456' },
      { headers: {}, socket: {} } as any,
      response
    );

    expect(response.cookie).toHaveBeenCalledWith(
      PRODUCTION_SESSION_COOKIE,
      'access-token',
      expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'strict', path: '/' })
    );
    expect(response.cookie).toHaveBeenCalledWith(
      PRODUCTION_CSRF_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: true, httpOnly: false, sameSite: 'strict', path: '/' })
    );
    expect(response.clearCookie).toHaveBeenCalledWith(DEVELOPMENT_SESSION_COOKIE, expect.anything());
    expect(response.clearCookie).toHaveBeenCalledWith(DEVELOPMENT_CSRF_COOKIE, expect.anything());
  });
});
