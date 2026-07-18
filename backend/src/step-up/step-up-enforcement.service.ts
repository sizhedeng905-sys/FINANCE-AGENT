import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, StepUpGrantStatus, UserStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import type { StepUpDto } from '../auth/dto/step-up.dto';
import { STEP_UP_ACTIONS, StepUpAction, stepUpDefinition } from './step-up-actions';

interface StepUpPayload {
  sub?: string;
  ver?: number;
  typ?: string;
  sid?: string;
  act?: string;
  rty?: string;
  rid?: string;
  jti?: string;
}

class StepUpRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type StepUpWriter = Prisma.TransactionClient | PrismaService;

@Injectable()
export class StepUpEnforcementService {
  private readonly mode: string;
  private readonly ttlSeconds: number;
  private readonly enforcedActions: ReadonlySet<StepUpAction>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService
  ) {
    this.mode = config.get<string>('stepUp.mode') ?? 'disabled';
    this.ttlSeconds = config.get<number>('stepUp.ttlSeconds') ?? 300;
    this.enforcedActions = new Set(config.get<StepUpAction[]>('stepUp.enforcedActions') ?? []);
  }

  capabilities() {
    return {
      mode: this.mode,
      ttlSeconds: this.ttlSeconds,
      expiresInSeconds: this.ttlSeconds,
      maxUses: 1,
      tokenHeader: 'X-Step-Up-Token',
      enforcedActions: [...this.enforcedActions],
      registeredActions: STEP_UP_ACTIONS.map((action) => ({
        action,
        resourceType: stepUpDefinition(action).resourceType,
        enforcement: stepUpDefinition(action).enforcement
      })),
      mfa: { status: 'reserved', enabled: false },
      pendingDecisionRefs: ['H10']
    };
  }

  requires(action: StepUpAction) {
    return this.mode === 'enforce' && this.enforcedActions.has(action);
  }

  async issue(dto: StepUpDto, actor: CurrentUser, context: RequestContext) {
    const sessionId = actor.sessionId;
    if (!sessionId) throw new UnauthorizedException('STEP_UP_SESSION_BINDING_REQUIRED');
    const definition = stepUpDefinition(dto.action);
    if (definition.enforcement !== 'attached') {
      throw new BadRequestException('STEP_UP_ACTION_NOT_ATTACHED');
    }
    if (dto.resourceType !== definition.resourceType) {
      throw new UnauthorizedException('STEP_UP_RESOURCE_TYPE_MISMATCH');
    }

    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1_000);
    const token = await this.jwt.signAsync(
      {
        sub: actor.id,
        ver: actor.tokenVersion,
        typ: 'step_up',
        sid: sessionId,
        act: dto.action,
        rty: dto.resourceType,
        rid: dto.resourceId,
        jti: tokenId
      },
      {
        secret: this.configOrThrow('jwtSecret'),
        expiresIn: this.ttlSeconds,
        algorithm: 'HS256',
        issuer: this.configOrThrow('jwtIssuer'),
        audience: this.configOrThrow('jwtAudience')
      }
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: actor.id } });
        if (
          !user ||
          user.status !== UserStatus.active ||
          user.tokenVersion !== actor.tokenVersion ||
          user.role !== actor.role
        ) {
          throw new StepUpRejected('CURRENT_IDENTITY_CHANGED');
        }
        await tx.stepUpGrant.updateMany({
          where: {
            userId: actor.id,
            sessionIdHash: this.hashOpaque(sessionId),
            action: dto.action,
            resourceType: dto.resourceType,
            resourceId: dto.resourceId,
            status: StepUpGrantStatus.active
          },
          data: { status: StepUpGrantStatus.revoked, revokedAt: new Date() }
        });
        const grant = await tx.stepUpGrant.create({
          data: {
            tokenIdHash: this.hashOpaque(tokenId),
            userId: actor.id,
            sessionIdHash: this.hashOpaque(sessionId),
            action: dto.action,
            resourceType: dto.resourceType,
            resourceId: dto.resourceId,
            roleSnapshot: actor.role,
            tokenVersion: actor.tokenVersion,
            expiresAt
          }
        });
        await this.auditLogs.write(
          tx,
          actor,
          'auth.step_up.success',
          dto.resourceType,
          dto.resourceId,
          {
            grantId: grant.id,
            action: dto.action,
            expiresAt: expiresAt.toISOString(),
            maxUses: 1,
            sessionBound: true,
            mfaVerified: false,
            pendingDecisionRefs: ['H10']
          },
          context
        );
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const reason = error instanceof StepUpRejected ? error.reason : 'GRANT_ISSUANCE_FAILED';
      await this.auditFailure(actor, dto.action, dto.resourceType, dto.resourceId, reason, context);
      throw new UnauthorizedException('STEP_UP_ISSUANCE_REJECTED');
    }

    return {
      stepUpToken: token,
      expiresInSeconds: this.ttlSeconds,
      maxUses: 1,
      binding: { action: dto.action, resourceType: dto.resourceType, resourceId: dto.resourceId },
      mfa: { status: 'reserved', verified: false }
    };
  }

  async consume(
    token: string | undefined,
    actor: CurrentUser,
    action: StepUpAction,
    resourceType: string,
    resourceId: string,
    context: RequestContext
  ) {
    if (!this.requires(action)) return;
    if (!token || !actor.sessionId) {
      await this.auditFailure(actor, action, resourceType, resourceId, 'TOKEN_OR_SESSION_MISSING', context);
      throw new UnauthorizedException('STEP_UP_REQUIRED');
    }

    let payload: StepUpPayload;
    try {
      payload = await this.jwt.verifyAsync<StepUpPayload>(token, {
        secret: this.configOrThrow('jwtSecret'),
        algorithms: ['HS256'],
        issuer: this.configOrThrow('jwtIssuer'),
        audience: this.configOrThrow('jwtAudience')
      });
    } catch {
      await this.auditFailure(actor, action, resourceType, resourceId, 'TOKEN_INVALID_OR_EXPIRED', context);
      throw new UnauthorizedException('STEP_UP_INVALID');
    }

    if (
      payload.typ !== 'step_up' ||
      payload.sub !== actor.id ||
      payload.ver !== actor.tokenVersion ||
      payload.sid !== actor.sessionId ||
      payload.act !== action ||
      payload.rty !== resourceType ||
      payload.rid !== resourceId ||
      !payload.jti
    ) {
      await this.auditFailure(actor, action, resourceType, resourceId, 'TOKEN_BINDING_MISMATCH', context);
      throw new UnauthorizedException('STEP_UP_BINDING_MISMATCH');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: actor.id } });
        if (
          !user ||
          user.status !== UserStatus.active ||
          user.tokenVersion !== actor.tokenVersion ||
          user.role !== actor.role
        ) {
          throw new StepUpRejected('CURRENT_IDENTITY_CHANGED');
        }
        const consumed = await tx.stepUpGrant.updateMany({
          where: {
            tokenIdHash: this.hashOpaque(payload.jti!),
            userId: actor.id,
            sessionIdHash: this.hashOpaque(actor.sessionId!),
            action,
            resourceType,
            resourceId,
            roleSnapshot: actor.role,
            tokenVersion: actor.tokenVersion,
            status: StepUpGrantStatus.active,
            useCount: 0,
            expiresAt: { gt: new Date() }
          },
          data: {
            status: StepUpGrantStatus.consumed,
            useCount: 1,
            consumedAt: new Date()
          }
        });
        if (consumed.count !== 1) throw new StepUpRejected('GRANT_EXPIRED_REVOKED_OR_REPLAYED');
        await this.auditLogs.write(
          tx,
          actor,
          'auth.step_up.consumed',
          resourceType,
          resourceId,
          { action, maxUses: 1, useCount: 1, sessionBound: true },
          context
        );
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const reason = error instanceof StepUpRejected ? error.reason : 'GRANT_CONSUMPTION_FAILED';
      await this.auditFailure(actor, action, resourceType, resourceId, reason, context);
      throw new UnauthorizedException('STEP_UP_INVALID_OR_ALREADY_USED');
    }
  }

  async revokeUserGrants(writer: StepUpWriter, userId: string) {
    await writer.stepUpGrant.updateMany({
      where: { userId, status: StepUpGrantStatus.active },
      data: { status: StepUpGrantStatus.revoked, revokedAt: new Date() }
    });
  }

  private async auditFailure(
    actor: CurrentUser,
    action: StepUpAction,
    resourceType: string,
    resourceId: string,
    reason: string,
    context: RequestContext
  ) {
    await this.auditLogs.write(
      this.prisma,
      actor,
      'auth.step_up.rejected',
      resourceType,
      resourceId,
      { action, reason, tokenPersisted: false },
      context
    );
  }

  private hashOpaque(value: string) {
    return createHash('sha256').update(`step-up-v1:${value}`).digest('hex');
  }

  private configOrThrow(key: 'jwtSecret' | 'jwtIssuer' | 'jwtAudience') {
    return this.config.getOrThrow<string>(key);
  }
}
