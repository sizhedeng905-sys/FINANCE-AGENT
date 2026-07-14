import { Injectable } from '@nestjs/common';
import { ModelDeploymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ModelExecutionGateService } from './model-execution-gate.service';
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
    return route ? { ...route, deployment: this.presentDeployment(route.deployment) } : undefined;
  }

  resolveSecret(secretRef?: string | null) {
    if (!secretRef || !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) return undefined;
    return process.env[secretRef] || undefined;
  }

  async health() {
    const deployments = await this.prisma.modelDeployment.findMany({ orderBy: { deploymentKey: 'asc' } });
    const results = [];
    for (const deployment of deployments) {
      results.push(await this.checkDeployment(deployment));
    }
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
    if (!deployment.isEnabled) {
      await this.updateHealth(deployment.id, ModelDeploymentStatus.disabled, 0, null);
      return { key: deployment.deploymentKey, provider: deployment.provider, model: deployment.modelName, enabled: false, healthy: false, status: 'disabled', latencyMs: 0 };
    }
    if (deployment.provider === 'mock') {
      await this.updateHealth(deployment.id, ModelDeploymentStatus.healthy, 0, null);
      return { key: deployment.deploymentKey, provider: deployment.provider, model: deployment.modelName, enabled: true, healthy: true, status: 'healthy', latencyMs: 0 };
    }
    if (!deployment.endpoint) {
      await this.updateHealth(deployment.id, ModelDeploymentStatus.unhealthy, 0, 'endpoint 未配置');
      return { key: deployment.deploymentKey, provider: deployment.provider, model: deployment.modelName, enabled: true, healthy: false, status: 'unhealthy', latencyMs: 0, error: 'endpoint 未配置' };
    }

    const url = deployment.provider === 'local_paddle'
      ? `${deployment.endpoint.replace(/\/+$/, '')}/health`
      : `${deployment.endpoint.replace(/\/+$/, '')}/models`;
    const startedAt = Date.now();
    try {
      const secret = this.resolveSecret(deployment.secretRef);
      const response = await this.http.request(url, {
        method: 'GET',
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined
      }, {
        circuitKey: `health:${deployment.deploymentKey}`,
        timeoutMs: Math.min(deployment.timeoutMs, 10000),
        maxRetries: 0
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.updateHealth(deployment.id, ModelDeploymentStatus.healthy, latencyMs, null);
      return { key: deployment.deploymentKey, provider: deployment.provider, model: deployment.modelName, enabled: true, healthy: true, status: 'healthy', latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = (error instanceof Error ? error.message : '健康检查失败').slice(0, 500);
      await this.updateHealth(deployment.id, ModelDeploymentStatus.unhealthy, latencyMs, message);
      return { key: deployment.deploymentKey, provider: deployment.provider, model: deployment.modelName, enabled: true, healthy: false, status: 'unhealthy', latencyMs, error: message };
    }
  }

  private updateHealth(id: string, status: ModelDeploymentStatus, latencyMs: number, error: string | null) {
    return this.prisma.modelDeployment.update({
      where: { id },
      data: { status, lastHealthAt: new Date(), lastHealthLatencyMs: latencyMs, lastError: error }
    });
  }

  private presentDeployment(item: Prisma.ModelDeploymentGetPayload<Record<string, never>>) {
    return {
      id: item.id,
      key: item.deploymentKey,
      provider: item.provider,
      modelName: item.modelName,
      modelVersion: item.modelVersion ?? undefined,
      endpoint: item.endpoint ?? undefined,
      secretRef: item.secretRef ?? undefined,
      taskTypes: Array.isArray(item.taskTypes) ? item.taskTypes : [],
      maxConcurrency: item.maxConcurrency,
      timeoutMs: item.timeoutMs,
      isLocal: item.isLocal,
      isEnabled: item.isEnabled,
      status: item.status,
      lastHealthAt: item.lastHealthAt?.toISOString(),
      lastHealthLatencyMs: item.lastHealthLatencyMs ?? undefined,
      lastError: item.lastError ?? undefined
    };
  }
}
