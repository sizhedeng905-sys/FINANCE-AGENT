import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toAuthUser } from '../common/utils/user-presenter';
import { PrismaService } from '../prisma/prisma.service';
import { StepUpEnforcementService } from '../step-up/step-up-enforcement.service';
import { LoginDto } from './dto/login.dto';
import { StepUpDto } from './dto/step-up.dto';
import { LoginRateLimitService, LoginReservation } from './login-rate-limit.service';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('finance-agent-dummy-password', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly loginRateLimit: LoginRateLimitService,
    private readonly stepUpEnforcement: StepUpEnforcementService
  ) {}

  async login(dto: LoginDto, context: RequestContext) {
    let reservation: LoginReservation;
    try {
      reservation = await this.loginRateLimit.reserve(dto.username, context.ip);
    } catch (error) {
      await this.auditLogs.writeAuthentication(
        this.prisma,
        {
          username: dto.username,
          success: false,
          failureReason: error instanceof HttpException && error.getStatus() === 429
            ? 'rate_limited'
            : 'rate_limit_store_unavailable'
        },
        context
      );
      throw error;
    }

    let user;
    let passwordMatched = false;
    try {
      user = await this.prisma.user.findUnique({ where: { username: dto.username } });
      passwordMatched = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    } catch (error) {
      await this.loginRateLimit.release(reservation).catch(() => undefined);
      throw error;
    }

    if (!user || user.status !== UserStatus.active || !passwordMatched) {
      let limiterError: unknown;
      try {
        await this.loginRateLimit.failure(reservation);
      } catch (error) {
        limiterError = error;
      }
      await this.auditLogs.writeAuthentication(
        this.prisma,
        {
          userId: user?.id,
          username: dto.username,
          success: false,
          failureReason: user && user.status !== UserStatus.active ? 'account_disabled' : 'invalid_credentials'
        },
        context
      );
      if (limiterError) throw limiterError;
      throw new UnauthorizedException('账号或密码错误');
    }

    try {
      await this.loginRateLimit.success(reservation);
    } catch (error) {
      await this.auditLogs.writeAuthentication(
        this.prisma,
        { userId: user.id, username: user.username, success: false, failureReason: 'rate_limit_store_unavailable' },
        context
      );
      throw error;
    }

    const accessToken = await this.signAccessToken(
      user.id,
      user.tokenVersion,
      randomUUID(),
      (this.configService.get<string>('jwtExpiresIn') ?? '8h') as JwtSignOptions['expiresIn']
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
      await this.stepUpEnforcement.revokeUserGrants(tx, actor.id);
      await this.auditLogs.write(tx, actor, 'auth.logout', 'auth_session', actor.id, { revokedVersion: actor.tokenVersion }, context);
      return { success: true };
    });
  }

  async stepUp(dto: StepUpDto, actor: CurrentUser, context: RequestContext) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    const passwordMatched = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || user.status !== UserStatus.active || !passwordMatched) {
      await this.auditLogs.write(
        this.prisma,
        actor,
        'auth.step_up.failure',
        'auth_session',
        actor.id,
        {
          success: false,
          action: dto.action,
          requestedResourceType: dto.resourceType,
          requestedResourceId: dto.resourceId,
          reason: 'PASSWORD_REJECTED'
        },
        context
      );
      throw new UnauthorizedException('Step-up authentication failed');
    }

    return this.stepUpEnforcement.issue(dto, actor, context);
  }

  private signAccessToken(
    userId: string,
    tokenVersion: number,
    sessionId: string,
    expiresIn: JwtSignOptions['expiresIn']
  ) {
    return this.jwtService.signAsync(
      { sub: userId, ver: tokenVersion, typ: 'access', sid: sessionId },
      {
        secret: this.configService.getOrThrow<string>('jwtSecret'),
        expiresIn,
        algorithm: 'HS256',
        issuer: this.configService.getOrThrow<string>('jwtIssuer'),
        audience: this.configService.getOrThrow<string>('jwtAudience')
      }
    );
  }
}
