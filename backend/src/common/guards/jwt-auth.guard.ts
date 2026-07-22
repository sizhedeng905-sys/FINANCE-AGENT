import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Response } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest, CurrentUser } from '../types/current-user';
import {
  csrfCookieName,
  DEVELOPMENT_CSRF_COOKIE,
  DEVELOPMENT_SESSION_COOKIE,
  parseCookieHeaderDetails,
  PRODUCTION_CSRF_COOKIE,
  PRODUCTION_SESSION_COOKIE,
  rejectedCookieNames,
  sessionCookieName
} from '../utils/auth-cookies';

interface JwtPayload {
  sub?: string;
  ver?: number;
  typ?: 'access' | 'step_up';
  sid?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const production = this.configService.get<string>('nodeEnv') === 'production';
    const parsedCookies = parseCookieHeaderDetails(request.headers.cookie);
    this.assertCookieBoundary(parsedCookies, production, response);
    const authentication = this.extractToken(request, parsedCookies.cookies, production);

    if (!authentication) throw new UnauthorizedException('Authentication required');
    if (authentication.source === 'cookie') this.assertCsrf(request, parsedCookies.cookies, production);

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(authentication.token, {
        secret: this.configService.getOrThrow<string>('jwtSecret'),
        algorithms: ['HS256'],
        issuer: this.configService.getOrThrow<string>('jwtIssuer'),
        audience: this.configService.getOrThrow<string>('jwtAudience')
      });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    if (!payload.sub || !Number.isInteger(payload.ver) || payload.typ !== 'access' || !payload.sid) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== UserStatus.active || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException('Invalid token');
    }

    request.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department ?? '',
      phone: user.phone ?? '',
      status: user.status,
      tokenVersion: user.tokenVersion,
      sessionId: payload.sid
    } satisfies CurrentUser;
    return true;
  }

  private extractToken(
    request: AuthenticatedRequest,
    cookies: Record<string, string>,
    production: boolean
  ): { token: string; source: 'bearer' | 'cookie' } | undefined {
    const authorization = request.headers.authorization;
    if (Array.isArray(authorization)) return undefined;

    const [type, token] = authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) return { token, source: 'bearer' };
    const cookieToken = cookies[sessionCookieName(production)];
    return cookieToken ? { token: cookieToken, source: 'cookie' } : undefined;
  }

  private assertCsrf(request: AuthenticatedRequest, cookies: Record<string, string>, production: boolean) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;
    const cookieToken = cookies[csrfCookieName(production)];
    const header = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(header) ? undefined : header;
    if (!cookieToken || !headerToken) throw new UnauthorizedException('CSRF validation failed');
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);
    if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
      throw new UnauthorizedException('CSRF validation failed');
    }
  }

  private assertCookieBoundary(
    parsed: ReturnType<typeof parseCookieHeaderDetails>,
    production: boolean,
    response: Response
  ) {
    const authenticationCookieNames = new Set([
      DEVELOPMENT_SESSION_COOKIE,
      PRODUCTION_SESSION_COOKIE,
      DEVELOPMENT_CSRF_COOKIE,
      PRODUCTION_CSRF_COOKIE
    ]);
    const rejected = rejectedCookieNames(production).filter((name) => parsed.names.has(name));
    const duplicated = [...parsed.duplicateNames].filter((name) => authenticationCookieNames.has(name));
    const invalid = [...new Set([...rejected, ...duplicated])];
    if (invalid.length === 0) return;

    for (const name of invalid) {
      response.clearCookie(name, {
        path: '/',
        secure: name.startsWith('__Host-'),
        sameSite: 'strict',
        httpOnly: name.includes('session')
      });
    }
    throw new UnauthorizedException('Authentication cookie policy violation');
  }
}
