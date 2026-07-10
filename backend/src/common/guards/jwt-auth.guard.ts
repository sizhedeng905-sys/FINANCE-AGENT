import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest, CurrentUser } from '../types/current-user';

interface JwtPayload {
  sub?: string;
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
    const token = this.extractToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('未登录');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('jwtSecret')
      });
    } catch {
      throw new UnauthorizedException('Token 失效');
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token 失效');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub
      }
    });

    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Token 失效');
    }

    request.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department ?? '',
      phone: user.phone ?? '',
      status: user.status
    } satisfies CurrentUser;

    return true;
  }

  private extractToken(authorization: string | string[] | undefined): string | undefined {
    if (Array.isArray(authorization)) {
      return undefined;
    }

    const [type, token] = authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
