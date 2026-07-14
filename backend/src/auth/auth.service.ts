import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toAuthUser } from '../common/utils/user-presenter';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LoginRateLimitService } from './login-rate-limit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly loginRateLimit: LoginRateLimitService
  ) {}

  async login(dto: LoginDto, context: RequestContext) {
    try {
      this.loginRateLimit.assertAllowed(dto.username, context.ip);
    } catch (error) {
      await this.auditLogs.writeAuthentication(
        this.prisma,
        { username: dto.username, success: false, failureReason: 'rate_limited' },
        context
      );
      throw error;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        username: dto.username
      }
    });

    if (!user || user.status !== UserStatus.active) {
      this.loginRateLimit.recordFailure(dto.username, context.ip);
      await this.auditLogs.writeAuthentication(
        this.prisma,
        {
          userId: user?.id,
          username: dto.username,
          success: false,
          failureReason: user ? 'account_disabled' : 'invalid_credentials'
        },
        context
      );
      throw new UnauthorizedException('账号或密码错误');
    }

    const passwordMatched = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatched) {
      this.loginRateLimit.recordFailure(dto.username, context.ip);
      await this.auditLogs.writeAuthentication(
        this.prisma,
        { userId: user.id, username: dto.username, success: false, failureReason: 'invalid_credentials' },
        context
      );
      throw new UnauthorizedException('账号或密码错误');
    }

    this.loginRateLimit.reset(dto.username, context.ip);

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        ver: user.tokenVersion
      },
      {
        secret: this.configService.getOrThrow<string>('jwtSecret'),
        expiresIn: '7d'
      }
    );

    await this.auditLogs.writeAuthentication(
      this.prisma,
      { userId: user.id, username: user.username, success: true },
      context
    );

    return {
      accessToken,
      user: toAuthUser(user)
    };
  }

  async logout(actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { tokenVersion: { increment: 1 } } });
      await this.auditLogs.write(tx, actor, 'auth.logout', 'auth_session', actor.id, { revokedVersion: actor.tokenVersion }, context);
      return { success: true };
    });
  }
}
