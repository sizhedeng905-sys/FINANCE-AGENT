import { Injectable } from '@nestjs/common';
import { ModelDeploymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { resolveModelDeployment } from './model-deployment-config';
import { ModelExecutionGateService } from './model-execution-gate.service';
import { probeModelDeployment } from './model-health-probe';
import { ResilientHttpClientService } from './resilient-http-client.service';

@Injectable()
export class ModelRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ResilientHttpClientService,
    private readonly gate: ModelExecutionGateService
  ) {}

  async deployments() {
    const items = await this.prisma.modelDeployment.findMany({ orderBy: { deploymentKey: 'asc' } });
    return items.map((item) => this.presentDeployment(item));
  }

  async routes() {
    const routes = await this.prisma.taskModelRoute.findMany({
      include: { deployment: true },
      orderBy: [{ taskType: 'asc' }, { priority: 'asc' }]
    });
    return routes.map((route) => ({
      id: route.id,
      taskType: route.taskType,
      priority: route.priority,
      isEnabled: route.isEnabled,
      fallbackPolicy: route.fallbackPolicy,
      deployment: this.presentDeployment(route.deployment)
    }));
  }

  async resolve(taskType: string) {
    const route = await this.prisma.taskModelRoute.findFirst({
      where: { taskType, isEnabled: true, deployment: { isEnabled: true } },
      include: { deployment: true },
      orderBy: { priority: 'asc' }
    });
    return route ? { ...route, deployment: resolveModelDeployment(route.deployment) } : undefined;
  }

  resolveSecret(secretRef?: string | null) {
    if (!secretRef || !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) return undefined;
    return process.env[secretRef] || undefined;
  }

  async health() {
    const deployments = await this.prisma.modelDeployment.findMany({ orderBy: { deploymentKey: 'asc' } });
    const results = [];
    for (const deployment of deployments) results.push(await this.checkDeployment(deployment));
    const enabled = results.filter((item) => item.enabled);
    return {
      status: enabled.every((item) => item.healthy) ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      deployments: results,
      runtime: {
        queues: this.gate.snapshot(),
        circuits: this.http.snapshot()
      }
    };
  }

  private async checkDeployment(deployment: Prisma.ModelDeploymentGetPayload<Record<string, never>>) {
    const resolved = resolveModelDeployment(deployment);
    if (!resolved.isEnabled) {
      await this.updateHealth(resolved.id, ModelDeploymentStatus.disabled, 0, null);
      return {
        key: resolved.key,
        provider: resolved.provider,
        model: resolved.modelName,
        modelVersion: resolved.modelVersion,
        configHash: resolved.configHash,
        enabled: false,
        healthy: false,
        status: 'disabled',
        latencyMs: 0
      };
    }

    const startedAt = Date.now();
    try {
      const probe = await probeModelDeployment(
        resolved,
        this.resolveSecret(resolved.secretRef),
        (url, init, timeoutMs, operation) => this.http.request(url, init, {
          circuitKey: `health:${resolved.key}:${operation}`,
          timeoutMs,
          maxRetries: 0
        })
      );
      await this.updateHealth(resolved.id, ModelDeploymentStatus.healthy, probe.latencyMs, null);
      return {
        key: resolved.key,
        provider: resolved.provider,
        model: resolved.modelName,
        modelVersion: probe.identity.modelVersion,
        capabilities: probe.identity.capabilities,
        configHash: resolved.configHash,
        enabled: true,
        healthy: true,
        status: 'healthy',
        latencyMs: probe.latencyMs
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = (error instanceof Error ? error.message : 'Model health check failed').slice(0, 500);
      await this.updateHealth(resolved.id, ModelDeploymentStatus.unhealthy, latencyMs, message);
      return {
        key: resolved.key,
        provider: resolved.provider,
        model: resolved.modelName,
        modelVersion: resolved.modelVersion,
        configHash: resolved.configHash,
        enabled: true,
        healthy: false,
        status: 'unhealthy',
        latencyMs,
        error: message
      };
    }
  }

  private updateHealth(id: string, status: ModelDeploymentStatus, latencyMs: number, error: string | null) {
    return this.prisma.modelDeployment.update({
      where: { id },
      data: { status, lastHealthAt: new Date(), lastHealthLatencyMs: latencyMs, lastError: error }
    });
  }

  private presentDeployment(item: Prisma.ModelDeploymentGetPayload<Record<string, never>>) {
    const resolved = resolveModelDeployment(item);
    return {
      id: resolved.id,
      key: resolved.key,
      provider: resolved.provider,
      modelName: resolved.modelName,
      modelVersion: resolved.modelVersion,
      endpoint: resolved.endpoint,
      secretRef: resolved.secretRef,
      taskTypes: resolved.taskTypes,
      maxConcurrency: resolved.maxConcurrency,
      timeoutMs: resolved.timeoutMs,
      isLocal: resolved.isLocal,
      isEnabled: resolved.isEnabled,
      configHash: resolved.configHash,
      status: item.status,
      lastHealthAt: item.lastHealthAt?.toISOString(),
      lastHealthLatencyMs: item.lastHealthLatencyMs ?? undefined,
      lastError: item.lastError ?? undefined
    };
  }
}
