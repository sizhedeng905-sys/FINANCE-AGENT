import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest, CurrentUser } from '../types/current-user';
import {
  DEVELOPMENT_CSRF_COOKIE,
  DEVELOPMENT_SESSION_COOKIE,
  parseCookieHeader,
  PRODUCTION_CSRF_COOKIE,
  PRODUCTION_SESSION_COOKIE
} from '../utils/auth-cookies';

interface JwtPayload {
  sub?: string;
  ver?: number;
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
    const authentication = this.extractToken(request);

    if (!authentication) {
      throw new UnauthorizedException('未登录');
    }
    if (authentication.source === 'cookie') this.assertCsrf(request);

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(authentication.token, {
        secret: this.configService.getOrThrow<string>('jwtSecret')
      });
    } catch {
      throw new UnauthorizedException('Token 失效');
    }

    if (!payload.sub || !Number.isInteger(payload.ver)) {
      throw new UnauthorizedException('Token 失效');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub
      }
    });

    if (!user || user.status !== UserStatus.active || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException('Token 失效');
    }

    request.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department ?? '',
      phone: user.phone ?? '',
      status: user.status,
      tokenVersion: user.tokenVersion
    } satisfies CurrentUser;

    return true;
  }

  private extractToken(request: AuthenticatedRequest): { token: string; source: 'bearer' | 'cookie' } | undefined {
    const authorization = request.headers.authorization;
    if (Array.isArray(authorization)) {
      return undefined;
    }

    const [type, token] = authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) return { token, source: 'bearer' };
    const cookies = parseCookieHeader(request.headers.cookie);
    const cookieToken = cookies[PRODUCTION_SESSION_COOKIE] ?? cookies[DEVELOPMENT_SESSION_COOKIE];
    return cookieToken ? { token: cookieToken, source: 'cookie' } : undefined;
  }

  private assertCsrf(request: AuthenticatedRequest) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;
    const cookies = parseCookieHeader(request.headers.cookie);
    const cookieToken = cookies[PRODUCTION_CSRF_COOKIE] ?? cookies[DEVELOPMENT_CSRF_COOKIE];
    const header = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(header) ? undefined : header;
    if (!cookieToken || !headerToken) throw new UnauthorizedException('CSRF 校验失败');
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);
    if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
      throw new UnauthorizedException('CSRF 校验失败');
    }
  }
}
