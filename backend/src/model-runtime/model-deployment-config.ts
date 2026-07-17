import { createHash } from 'node:crypto';

export interface ResolvedModelDeployment {
  id: string;
  key: string;
  provider: string;
  modelName: string;
  modelVersion?: string;
  endpoint?: string;
  secretRef?: string;
  taskTypes: string[];
  maxConcurrency: number;
  timeoutMs: number;
  isLocal: boolean;
  isEnabled: boolean;
  configHash: string;
}

interface ModelDeploymentRecord {
  id: string;
  deploymentKey: string;
  provider: string;
  modelName: string;
  modelVersion: string | null;
  endpoint: string | null;
  secretRef: string | null;
  taskTypes: unknown;
  maxConcurrency: number;
  timeoutMs: number;
  isLocal: boolean;
  isEnabled: boolean;
}

export function resolveModelDeployment(record: ModelDeploymentRecord): ResolvedModelDeployment {
  const taskTypes = Array.isArray(record.taskTypes)
    ? record.taskTypes.filter((item): item is string => typeof item === 'string').sort()
    : [];
  const snapshot = {
    id: record.id,
    key: record.deploymentKey,
    provider: record.provider,
    modelName: record.modelName,
    modelVersion: record.modelVersion ?? undefined,
    endpoint: record.endpoint?.replace(/\/+$/, '') || undefined,
    secretRef: record.secretRef ?? undefined,
    taskTypes,
    maxConcurrency: record.maxConcurrency,
    timeoutMs: record.timeoutMs,
    isLocal: record.isLocal,
    isEnabled: record.isEnabled
  };
  return {
    ...snapshot,
    configHash: hashModelDeployment(snapshot)
  };
}

export function hashModelDeployment(snapshot: Omit<ResolvedModelDeployment, 'configHash'>) {
  return createHash('sha256').update(JSON.stringify({
    id: snapshot.id,
    key: snapshot.key,
    provider: snapshot.provider,
    modelName: snapshot.modelName,
    modelVersion: snapshot.modelVersion ?? null,
    endpoint: snapshot.endpoint ?? null,
    secretRef: snapshot.secretRef ?? null,
    taskTypes: snapshot.taskTypes,
    maxConcurrency: snapshot.maxConcurrency,
    timeoutMs: snapshot.timeoutMs,
    isLocal: snapshot.isLocal,
    isEnabled: snapshot.isEnabled
  })).digest('hex');
}

export function modelExecutionSnapshot(deployment: ResolvedModelDeployment) {
  return {
    deploymentId: deployment.id,
    deploymentKey: deployment.key,
    provider: deployment.provider,
    modelName: deployment.modelName,
    modelVersion: deployment.modelVersion ?? null,
    endpoint: deployment.endpoint ?? null,
    secretRef: deployment.secretRef ?? null,
    taskTypes: deployment.taskTypes,
    timeoutMs: deployment.timeoutMs,
    maxConcurrency: deployment.maxConcurrency,
    isLocal: deployment.isLocal,
    configHash: deployment.configHash
  };
}
