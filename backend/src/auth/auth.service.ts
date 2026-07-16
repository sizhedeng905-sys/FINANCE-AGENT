import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toAuthUser } from '../common/utils/user-presenter';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { StepUpDto } from './dto/step-up.dto';
import { LoginRateLimitService } from './login-rate-limit.service';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('finance-agent-dummy-password', 10);

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
    let reservation;
    try {
      reservation = this.loginRateLimit.reserve(dto.username, context.ip);
    } catch (error) {
      await this.auditLogs.writeAuthentication(
        this.prisma,
        { username: dto.username, success: false, failureReason: 'rate_limited' },
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
      this.loginRateLimit.release(reservation);
      throw error;
    }

    if (!user || user.status !== UserStatus.active || !passwordMatched) {
      this.loginRateLimit.failure(reservation);
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
      throw new UnauthorizedException('账号或密码错误');
    }

    this.loginRateLimit.success(reservation);

    const accessToken = await this.signToken(
      user.id,
      user.tokenVersion,
      'access',
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
        { success: false },
        context
      );
      throw new UnauthorizedException('Step-up authentication failed');
    }

    const stepUpToken = await this.signToken(user.id, user.tokenVersion, 'step_up', '5m');
    await this.auditLogs.write(
      this.prisma,
      actor,
      'auth.step_up.success',
      'auth_session',
      actor.id,
      { success: true, expiresInSeconds: 300 },
      context
    );
    return {
      stepUpToken,
      expiresInSeconds: 300,
      mfa: { status: 'reserved', verified: false }
    };
  }

  private signToken(
    userId: string,
    tokenVersion: number,
    type: 'access' | 'step_up',
    expiresIn: JwtSignOptions['expiresIn']
  ) {
    return this.jwtService.signAsync(
      { sub: userId, ver: tokenVersion, typ: type },
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
