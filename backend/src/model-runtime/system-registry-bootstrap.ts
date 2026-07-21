import {
  AiPromptVersion,
  ModelDeployment,
  ModelDeploymentStatus,
  Prisma,
  PrismaClient,
  TaskModelRoute
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { canonicalJson } from '../common/utils/canonical-json';
import { AI_PROMPT_DEFINITIONS, AiPromptDefinition } from './ai-prompt-registry';
import {
  ResolvedSystemRegistryManifest,
  SystemModelDeploymentManifest,
  SystemModelRouteManifest
} from './system-registry-manifest';

const SYSTEM_REGISTRY_LOCK_KEY = 'finance-agent:ai-system-registry:v1';
const SYSTEM_REGISTRY_BOOTSTRAP_MAX_ATTEMPTS = 3;

type RegistryReader = Pick<
  Prisma.TransactionClient,
  'aiPromptVersion' | 'modelDeployment' | 'taskModelRoute'
>;

export interface SystemRegistryBootstrapResult {
  profile: string;
  manifestSha256: string;
  changed: boolean;
  promptsCreated: number;
  promptsActivated: number;
  promptsDeactivated: number;
  deploymentsCreated: number;
  routesCreated: number;
  promptCount: number;
  deploymentCount: number;
  routeCount: number;
}

export interface SystemRegistryVerificationResult {
  profile: string;
  manifestSha256: string;
  promptCount: number;
  deploymentCount: number;
  routeCount: number;
  enabledDeploymentCount: number;
  enabledRouteCount: number;
}

export async function bootstrapSystemRegistry(
  prisma: PrismaClient,
  manifest: ResolvedSystemRegistryManifest
): Promise<SystemRegistryBootstrapResult> {
  for (let attempt = 1; attempt <= SYSTEM_REGISTRY_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => applySystemRegistry(tx, manifest),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000
        }
      );
    } catch (error) {
      if (!isRetryableBootstrapConflict(error) || attempt === SYSTEM_REGISTRY_BOOTSTRAP_MAX_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
  throw new Error('System registry bootstrap retry budget was exhausted.');
}

export async function applySystemRegistry(
  tx: Prisma.TransactionClient,
  manifest: ResolvedSystemRegistryManifest
): Promise<SystemRegistryBootstrapResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${SYSTEM_REGISTRY_LOCK_KEY}, 31))`;

  const current = await readRegistry(tx);
  preflightRegistry(current, manifest);

  let promptsCreated = 0;
  let promptsActivated = 0;
  let promptsDeactivated = 0;
  let deploymentsCreated = 0;
  let routesCreated = 0;

  for (const definition of AI_PROMPT_DEFINITIONS) {
    const currentPrompt = current.prompts.find((prompt) => (
      prompt.promptKey === definition.promptKey && prompt.versionNo === definition.versionNo
    ));
    const deactivated = await tx.aiPromptVersion.updateMany({
      where: {
        promptKey: definition.promptKey,
        isActive: true,
        versionNo: { not: definition.versionNo }
      },
      data: { isActive: false }
    });
    promptsDeactivated += deactivated.count;

    if (!currentPrompt) {
      await tx.aiPromptVersion.create({ data: promptCreateData(definition) });
      promptsCreated += 1;
    } else if (!currentPrompt.isActive) {
      await tx.aiPromptVersion.update({
        where: { id: currentPrompt.id },
        data: { isActive: true }
      });
      promptsActivated += 1;
    }
  }

  const deploymentIds = new Map(current.deployments.map((deployment) => [
    deployment.deploymentKey,
    deployment.id
  ]));
  for (const expected of manifest.deployments) {
    if (deploymentIds.has(expected.deploymentKey)) continue;
    const created = await tx.modelDeployment.create({
      data: deploymentCreateData(expected)
    });
    deploymentIds.set(expected.deploymentKey, created.id);
    deploymentsCreated += 1;
  }

  const currentRouteKeys = new Set(current.routes.map((route) => routeIdentity(
    route.taskType,
    current.deploymentById.get(route.deploymentId)?.deploymentKey ?? ''
  )));
  for (const expected of manifest.routes) {
    const identity = routeIdentity(expected.taskType, expected.deploymentKey);
    if (currentRouteKeys.has(identity)) continue;
    await tx.taskModelRoute.create({
      data: {
        id: routeId(expected),
        taskType: expected.taskType,
        deploymentId: deploymentIds.get(expected.deploymentKey)!,
        priority: expected.priority,
        isEnabled: expected.initialEnabled,
        fallbackPolicy: expected.fallbackPolicy
      }
    });
    routesCreated += 1;
  }

  const changed = promptsCreated + promptsActivated + promptsDeactivated + deploymentsCreated + routesCreated > 0;
  if (changed) {
    await tx.auditLog.create({
      data: {
        action: 'system_registry.bootstrap',
        resourceType: 'ai_system_registry',
        resourceId: manifest.profile,
        metadata: {
          schemaVersion: manifest.schemaVersion,
          profile: manifest.profile,
          manifestSha256: manifest.manifestSha256,
          promptsCreated,
          promptsActivated,
          promptsDeactivated,
          deploymentsCreated,
          routesCreated
        }
      }
    });
  }

  const verification = await verifySystemRegistry(tx, manifest);
  return {
    ...verification,
    changed,
    promptsCreated,
    promptsActivated,
    promptsDeactivated,
    deploymentsCreated,
    routesCreated
  };
}

export async function verifySystemRegistry(
  db: RegistryReader,
  manifest: ResolvedSystemRegistryManifest,
  environment: NodeJS.ProcessEnv = process.env
): Promise<SystemRegistryVerificationResult> {
  const current = await readRegistry(db);
  preflightRegistry(current, manifest);

  const expectedPromptKeys = new Set(AI_PROMPT_DEFINITIONS.map((definition) => definition.promptKey));
  for (const definition of AI_PROMPT_DEFINITIONS) {
    const prompt = current.prompts.find((candidate) => (
      candidate.promptKey === definition.promptKey && candidate.versionNo === definition.versionNo
    ));
    if (!prompt) throw new Error(`System registry prompt is missing: ${promptIdentity(definition)}.`);
    if (!prompt.isActive || prompt.retiredAt) {
      throw new Error(`System registry prompt is not active: ${promptIdentity(definition)}.`);
    }
  }
  const unexpectedActivePrompt = current.prompts.find((prompt) => (
    prompt.isActive && !expectedPromptKeys.has(prompt.promptKey)
  ));
  if (unexpectedActivePrompt) {
    throw new Error(`Unexpected active system prompt: ${unexpectedActivePrompt.promptKey}.`);
  }

  const deploymentByKey = new Map(current.deployments.map((deployment) => [deployment.deploymentKey, deployment]));
  for (const expected of manifest.deployments) {
    const deployment = deploymentByKey.get(expected.deploymentKey);
    if (!deployment) throw new Error(`System registry deployment is missing: ${expected.deploymentKey}.`);
    if (deployment.isEnabled && deployment.secretRef && !environment[deployment.secretRef]) {
      throw new Error(`Enabled model deployment secret environment variable is missing: ${deployment.deploymentKey}.`);
    }
  }

  const routeByIdentity = new Map(current.routes.map((route) => {
    const deploymentKey = current.deploymentById.get(route.deploymentId)?.deploymentKey ?? '';
    return [routeIdentity(route.taskType, deploymentKey), route] as const;
  }));
  for (const expected of manifest.routes) {
    if (!routeByIdentity.has(routeIdentity(expected.taskType, expected.deploymentKey))) {
      throw new Error(`System registry route is missing: ${expected.taskType}/${expected.deploymentKey}.`);
    }
  }
  for (const route of current.routes) {
    if (!route.isEnabled) continue;
    const deployment = current.deploymentById.get(route.deploymentId);
    if (!deployment?.isEnabled) {
      throw new Error(`Enabled model route references a disabled deployment: ${route.taskType}.`);
    }
  }

  return {
    profile: manifest.profile,
    manifestSha256: manifest.manifestSha256,
    promptCount: AI_PROMPT_DEFINITIONS.length,
    deploymentCount: manifest.deployments.length,
    routeCount: manifest.routes.length,
    enabledDeploymentCount: current.deployments.filter((item) => item.isEnabled).length,
    enabledRouteCount: current.routes.filter((item) => item.isEnabled).length
  };
}

interface CurrentRegistry {
  prompts: AiPromptVersion[];
  deployments: ModelDeployment[];
  routes: TaskModelRoute[];
  deploymentById: Map<string, ModelDeployment>;
}

async function readRegistry(db: RegistryReader): Promise<CurrentRegistry> {
  const [prompts, deployments, routes] = await Promise.all([
    db.aiPromptVersion.findMany({ orderBy: [{ promptKey: 'asc' }, { versionNo: 'asc' }] }),
    db.modelDeployment.findMany({ orderBy: { deploymentKey: 'asc' } }),
    db.taskModelRoute.findMany({ orderBy: [{ taskType: 'asc' }, { priority: 'asc' }] })
  ]);
  return {
    prompts,
    deployments,
    routes,
    deploymentById: new Map(deployments.map((deployment) => [deployment.id, deployment]))
  };
}

function preflightRegistry(current: CurrentRegistry, manifest: ResolvedSystemRegistryManifest) {
  const managedPromptKeys = new Set(AI_PROMPT_DEFINITIONS.map((definition) => definition.promptKey));
  for (const prompt of current.prompts) {
    if (prompt.isActive && !managedPromptKeys.has(prompt.promptKey)) {
      throw new Error(`Unexpected active system prompt: ${prompt.promptKey}.`);
    }
  }
  for (const definition of AI_PROMPT_DEFINITIONS) {
    const existing = current.prompts.find((prompt) => (
      prompt.promptKey === definition.promptKey && prompt.versionNo === definition.versionNo
    ));
    if (!existing) continue;
    if (existing.retiredAt) {
      throw new Error(`System prompt version was retired and cannot be reactivated: ${promptIdentity(definition)}.`);
    }
    if (canonicalJson(promptFingerprint(existing)) !== canonicalJson(promptDefinitionFingerprint(definition))) {
      throw new Error(`System prompt configuration drift: ${promptIdentity(definition)}.`);
    }
  }

  const expectedDeploymentKeys = new Set(manifest.deployments.map((item) => item.deploymentKey));
  for (const deployment of current.deployments) {
    if (deployment.isEnabled && !expectedDeploymentKeys.has(deployment.deploymentKey)) {
      throw new Error(`Unexpected enabled model deployment: ${deployment.deploymentKey}.`);
    }
  }
  for (const expected of manifest.deployments) {
    const existing = current.deployments.find((item) => item.deploymentKey === expected.deploymentKey);
    if (!existing) continue;
    if (canonicalJson(deploymentFingerprint(existing)) !== canonicalJson(deploymentManifestFingerprint(expected))) {
      throw new Error(`Model deployment configuration drift: ${expected.deploymentKey}.`);
    }
  }

  const expectedRoutes = new Map(manifest.routes.map((route) => [
    routeIdentity(route.taskType, route.deploymentKey),
    route
  ]));
  for (const route of current.routes) {
    const deploymentKey = current.deploymentById.get(route.deploymentId)?.deploymentKey;
    if (!deploymentKey) throw new Error(`Model route references a missing deployment: ${route.taskType}.`);
    const expected = expectedRoutes.get(routeIdentity(route.taskType, deploymentKey));
    if (!expected) {
      if (route.isEnabled) throw new Error(`Unexpected enabled model route: ${route.taskType}/${deploymentKey}.`);
      continue;
    }
    if (route.priority !== expected.priority || route.fallbackPolicy !== expected.fallbackPolicy) {
      throw new Error(`Model route configuration drift: ${route.taskType}/${deploymentKey}.`);
    }
  }
}

function promptCreateData(definition: AiPromptDefinition): Prisma.AiPromptVersionUncheckedCreateInput {
  return {
    id: `ai-prompt-${definition.promptKey.replaceAll('_', '-')}-v${definition.versionNo}`,
    promptKey: definition.promptKey,
    versionNo: definition.versionNo,
    title: definition.title,
    purpose: definition.purpose,
    systemPrompt: definition.systemTemplate,
    userPromptTemplate: definition.userPromptTemplate,
    inputSchemaVersion: definition.inputSchemaVersion,
    outputSchemaVersion: definition.outputSchemaVersion,
    outputSchemaJson: definition.outputSchema as Prisma.InputJsonValue,
    allowedProviderClasses: definition.allowedProviderClasses as Prisma.InputJsonValue,
    maxInputBudget: definition.maxInputBudget,
    timeoutPolicy: definition.timeoutPolicy as Prisma.InputJsonValue,
    redactionPolicyVersion: definition.redactionPolicyVersion,
    requiredComponents: definition.requiredComponents as unknown as Prisma.InputJsonValue,
    contentSha256: definition.contentSha256,
    isActive: true,
    createdBy: 'system'
  };
}

function deploymentCreateData(
  deployment: SystemModelDeploymentManifest
): Prisma.ModelDeploymentUncheckedCreateInput {
  return {
    id: deploymentId(deployment.deploymentKey),
    deploymentKey: deployment.deploymentKey,
    provider: deployment.provider,
    modelName: deployment.modelName,
    modelVersion: deployment.modelVersion,
    endpoint: deployment.endpoint,
    secretRef: deployment.secretRef,
    taskTypes: deployment.taskTypes,
    maxConcurrency: deployment.maxConcurrency,
    timeoutMs: deployment.timeoutMs,
    isLocal: deployment.isLocal,
    isEnabled: deployment.initialEnabled,
    status: deployment.initialEnabled && deployment.provider === 'mock'
      ? ModelDeploymentStatus.healthy
      : deployment.initialEnabled
        ? ModelDeploymentStatus.unknown
        : ModelDeploymentStatus.disabled
  };
}

function promptDefinitionFingerprint(definition: AiPromptDefinition) {
  return {
    promptKey: definition.promptKey,
    versionNo: definition.versionNo,
    title: definition.title,
    purpose: definition.purpose,
    systemPrompt: definition.systemTemplate,
    userPromptTemplate: definition.userPromptTemplate,
    inputSchemaVersion: definition.inputSchemaVersion,
    outputSchemaVersion: definition.outputSchemaVersion,
    outputSchemaJson: definition.outputSchema,
    allowedProviderClasses: definition.allowedProviderClasses,
    maxInputBudget: definition.maxInputBudget,
    timeoutPolicy: definition.timeoutPolicy,
    redactionPolicyVersion: definition.redactionPolicyVersion,
    requiredComponents: definition.requiredComponents,
    contentSha256: definition.contentSha256,
    createdBy: 'system'
  };
}

function promptFingerprint(prompt: AiPromptVersion) {
  return {
    promptKey: prompt.promptKey,
    versionNo: prompt.versionNo,
    title: prompt.title,
    purpose: prompt.purpose,
    systemPrompt: prompt.systemPrompt,
    userPromptTemplate: prompt.userPromptTemplate,
    inputSchemaVersion: prompt.inputSchemaVersion,
    outputSchemaVersion: prompt.outputSchemaVersion,
    outputSchemaJson: prompt.outputSchemaJson,
    allowedProviderClasses: prompt.allowedProviderClasses,
    maxInputBudget: prompt.maxInputBudget,
    timeoutPolicy: prompt.timeoutPolicy,
    redactionPolicyVersion: prompt.redactionPolicyVersion,
    requiredComponents: prompt.requiredComponents,
    contentSha256: prompt.contentSha256,
    createdBy: prompt.createdBy
  };
}

function deploymentManifestFingerprint(deployment: SystemModelDeploymentManifest) {
  return {
    deploymentKey: deployment.deploymentKey,
    provider: deployment.provider,
    modelName: deployment.modelName,
    modelVersion: deployment.modelVersion,
    endpoint: deployment.endpoint,
    secretRef: deployment.secretRef,
    taskTypes: [...deployment.taskTypes].sort(),
    maxConcurrency: deployment.maxConcurrency,
    timeoutMs: deployment.timeoutMs,
    isLocal: deployment.isLocal
  };
}

function deploymentFingerprint(deployment: ModelDeployment) {
  return {
    deploymentKey: deployment.deploymentKey,
    provider: deployment.provider,
    modelName: deployment.modelName,
    modelVersion: deployment.modelVersion,
    endpoint: deployment.endpoint,
    secretRef: deployment.secretRef,
    taskTypes: Array.isArray(deployment.taskTypes)
      ? deployment.taskTypes.filter((item): item is string => typeof item === 'string').sort()
      : [],
    maxConcurrency: deployment.maxConcurrency,
    timeoutMs: deployment.timeoutMs,
    isLocal: deployment.isLocal
  };
}

function promptIdentity(definition: Pick<AiPromptDefinition, 'promptKey' | 'versionNo'>) {
  return `${definition.promptKey}:v${definition.versionNo}`;
}

function deploymentId(deploymentKey: string) {
  const known: Record<string, string> = {
    'mock-text': 'model-deployment-mock-text',
    'qwen3-14b-awq': 'model-deployment-qwen-text',
    'qwen3-vl-8b-instruct': 'model-deployment-qwen-vl',
    'paddleocr-vl': 'model-deployment-paddle-ocr',
    'qwen3-embedding-8b': 'model-deployment-qwen-embedding'
  };
  return known[deploymentKey]
    ?? `model-deployment-${createHash('sha256').update(deploymentKey).digest('hex').slice(0, 24)}`;
}

function routeId(route: SystemModelRouteManifest) {
  return `model-route-${createHash('sha256')
    .update(routeIdentity(route.taskType, route.deploymentKey))
    .digest('hex')
    .slice(0, 24)}`;
}

function routeIdentity(taskType: string, deploymentKey: string) {
  return `${taskType}\u0000${deploymentKey}`;
}

function isRetryableBootstrapConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002' || error.code === 'P2034';
  }
  return ['P2002', 'P2034'].includes(String((error as { code?: unknown } | null)?.code));
}
