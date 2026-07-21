import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { parseStrictJson, StrictJsonError } from './strict-json-parser';
import { isIP } from 'node:net';

export const SYSTEM_REGISTRY_SCHEMA_VERSION = 'ai-system-registry/1.0' as const;

export type SystemRegistryProfile = 'development-local-v1' | 'mock-safe-v1' | 'custom';
export type SystemRegistryStartupMode = 'disabled' | 'verify';
export type SystemModelProvider = 'mock' | 'openai' | 'openai_compatible' | 'local_paddle';
export type SystemRouteFallbackPolicy = 'manual' | 'mock';

export interface SystemModelDeploymentManifest {
  deploymentKey: string;
  provider: SystemModelProvider;
  modelName: string;
  modelVersion: string;
  endpoint: string | null;
  secretRef: string | null;
  taskTypes: string[];
  maxConcurrency: number;
  timeoutMs: number;
  isLocal: boolean;
  initialEnabled: boolean;
}

export interface SystemModelRouteManifest {
  taskType: string;
  deploymentKey: string;
  priority: number;
  initialEnabled: boolean;
  fallbackPolicy: SystemRouteFallbackPolicy;
}

export interface SystemRegistryManifest {
  schemaVersion: typeof SYSTEM_REGISTRY_SCHEMA_VERSION;
  deployments: SystemModelDeploymentManifest[];
  routes: SystemModelRouteManifest[];
}

export interface ResolvedSystemRegistryManifest extends SystemRegistryManifest {
  profile: SystemRegistryProfile;
  manifestSha256: string;
}

export interface SystemRegistryConfiguration {
  startupMode: SystemRegistryStartupMode;
  manifest: ResolvedSystemRegistryManifest;
}

const VALID_PROFILES = new Set<SystemRegistryProfile>([
  'development-local-v1',
  'mock-safe-v1',
  'custom'
]);
const VALID_STARTUP_MODES = new Set<SystemRegistryStartupMode>(['disabled', 'verify']);
const VALID_PROVIDERS = new Set<SystemModelProvider>(['mock', 'openai', 'openai_compatible', 'local_paddle']);
const VALID_FALLBACK_POLICIES = new Set<SystemRouteFallbackPolicy>(['manual', 'mock']);
const SAFE_KEY_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const TASK_TYPE_PATTERN = /^[a-z][a-z0-9_:-]{1,127}$/;
const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;

const MOCK_DEPLOYMENT: SystemModelDeploymentManifest = {
  deploymentKey: 'mock-text',
  provider: 'mock',
  modelName: 'mock-structured-v1',
  modelVersion: '1',
  endpoint: null,
  secretRef: null,
  taskTypes: [
    'boss_chat',
    'excel_template_classification',
    'excel_column_mapping',
    'ocr_document_classification',
    'ocr_field_mapping',
    'report_narrative',
    'report_fact_check'
  ],
  maxConcurrency: 4,
  timeoutMs: 5_000,
  isLocal: true,
  initialEnabled: true
};

const MOCK_ROUTES: SystemModelRouteManifest[] = MOCK_DEPLOYMENT.taskTypes.map((taskType) => ({
  taskType,
  deploymentKey: MOCK_DEPLOYMENT.deploymentKey,
  priority: 100,
  initialEnabled: true,
  fallbackPolicy: 'mock'
}));

const DEVELOPMENT_LOCAL_MANIFEST: SystemRegistryManifest = {
  schemaVersion: SYSTEM_REGISTRY_SCHEMA_VERSION,
  deployments: [
    MOCK_DEPLOYMENT,
    {
      deploymentKey: 'qwen3-14b-awq',
      provider: 'openai_compatible',
      modelName: 'Qwen/Qwen3-14B-AWQ',
      modelVersion: '0.23.0',
      endpoint: 'http://127.0.0.1:8000/v1',
      secretRef: 'AI_API_KEY',
      taskTypes: [
        'boss_chat',
        'structured_extraction',
        'risk_explanation',
        'excel_template_classification',
        'excel_column_mapping',
        'ocr_document_classification',
        'ocr_field_mapping',
        'report_narrative',
        'report_fact_check'
      ],
      maxConcurrency: 1,
      timeoutMs: 60_000,
      isLocal: true,
      initialEnabled: false
    },
    {
      deploymentKey: 'qwen3-vl-8b-instruct',
      provider: 'openai_compatible',
      modelName: 'Qwen/Qwen3-VL-8B-Instruct',
      modelVersion: '0.23.0',
      endpoint: 'http://127.0.0.1:8001/v1',
      secretRef: 'VL_API_KEY',
      taskTypes: ['ocr_ambiguity_review', 'document_vision'],
      maxConcurrency: 1,
      timeoutMs: 90_000,
      isLocal: true,
      initialEnabled: false
    },
    {
      deploymentKey: 'paddleocr-vl',
      provider: 'local_paddle',
      modelName: 'PaddlePaddle/PaddleOCR-VL',
      modelVersion: 'v1',
      endpoint: 'http://127.0.0.1:8868',
      secretRef: 'OCR_API_KEY',
      taskTypes: ['ocr_document'],
      maxConcurrency: 1,
      timeoutMs: 60_000,
      isLocal: true,
      initialEnabled: false
    },
    {
      deploymentKey: 'qwen3-embedding-8b',
      provider: 'openai_compatible',
      modelName: 'Qwen/Qwen3-Embedding-8B',
      modelVersion: '0.23.0',
      endpoint: 'http://127.0.0.1:8002/v1',
      secretRef: 'EMBEDDING_API_KEY',
      taskTypes: ['embedding'],
      maxConcurrency: 1,
      timeoutMs: 60_000,
      isLocal: true,
      initialEnabled: false
    }
  ],
  routes: [
    ...MOCK_ROUTES,
    ...[
      'boss_chat',
      'excel_template_classification',
      'excel_column_mapping',
      'ocr_document_classification',
      'ocr_field_mapping',
      'report_narrative',
      'report_fact_check'
    ].map((taskType): SystemModelRouteManifest => ({
      taskType,
      deploymentKey: 'qwen3-14b-awq',
      priority: 10,
      initialEnabled: false,
      fallbackPolicy: 'manual'
    })),
    {
      taskType: 'ocr_document',
      deploymentKey: 'paddleocr-vl',
      priority: 10,
      initialEnabled: false,
      fallbackPolicy: 'manual'
    },
    {
      taskType: 'ocr_ambiguity_review',
      deploymentKey: 'qwen3-vl-8b-instruct',
      priority: 10,
      initialEnabled: false,
      fallbackPolicy: 'manual'
    },
    {
      taskType: 'embedding',
      deploymentKey: 'qwen3-embedding-8b',
      priority: 10,
      initialEnabled: false,
      fallbackPolicy: 'manual'
    }
  ]
};

const MOCK_SAFE_MANIFEST: SystemRegistryManifest = {
  schemaVersion: SYSTEM_REGISTRY_SCHEMA_VERSION,
  deployments: [MOCK_DEPLOYMENT],
  routes: MOCK_ROUTES
};

export function resolveSystemRegistryConfiguration(
  environment: Record<string, unknown>
): SystemRegistryConfiguration {
  const nodeEnv = String(environment.NODE_ENV ?? 'development');
  const configuredProfile = String(environment.AI_SYSTEM_REGISTRY_PROFILE ?? '').trim();
  if (nodeEnv === 'production' && !configuredProfile) {
    throw new Error('AI_SYSTEM_REGISTRY_PROFILE is required in production.');
  }
  const profile = (configuredProfile || 'development-local-v1') as SystemRegistryProfile;
  if (!VALID_PROFILES.has(profile)) {
    throw new Error('AI_SYSTEM_REGISTRY_PROFILE must be development-local-v1, mock-safe-v1, or custom.');
  }

  const configuredStartupMode = String(environment.AI_SYSTEM_REGISTRY_STARTUP_MODE ?? '').trim();
  const startupMode = (
    configuredStartupMode || (nodeEnv === 'production' ? 'verify' : 'disabled')
  ) as SystemRegistryStartupMode;
  if (!VALID_STARTUP_MODES.has(startupMode)) {
    throw new Error('AI_SYSTEM_REGISTRY_STARTUP_MODE must be disabled or verify.');
  }
  if (nodeEnv === 'production' && startupMode !== 'verify') {
    throw new Error('AI_SYSTEM_REGISTRY_STARTUP_MODE must be verify in production.');
  }

  const customJson = String(environment.AI_SYSTEM_REGISTRY_MANIFEST_JSON ?? '').trim();
  if (profile !== 'custom' && customJson) {
    throw new Error('AI_SYSTEM_REGISTRY_MANIFEST_JSON is only allowed with custom profile.');
  }

  let source: unknown;
  if (profile === 'custom') {
    if (!customJson) throw new Error('AI_SYSTEM_REGISTRY_MANIFEST_JSON is required for custom profile.');
    try {
      source = parseStrictJson(customJson, {
        maxBytes: 64 * 1024,
        maxDepth: 8,
        maxNodes: 2_000,
        maxArrayLength: 256,
        maxStringLength: 2_048
      });
    } catch (error) {
      const detail = error instanceof StrictJsonError ? `${error.code}: ${error.message}` : 'INVALID_JSON';
      throw new Error(`AI_SYSTEM_REGISTRY_MANIFEST_JSON is invalid: ${detail}`);
    }
  } else {
    source = profile === 'mock-safe-v1' ? MOCK_SAFE_MANIFEST : DEVELOPMENT_LOCAL_MANIFEST;
  }

  const normalized = normalizeManifest(source);
  return {
    startupMode,
    manifest: {
      profile,
      ...normalized,
      manifestSha256: canonicalJsonSha256(normalized)
    }
  };
}

function normalizeManifest(value: unknown): SystemRegistryManifest {
  const source = requireRecord(value, 'system registry manifest');
  assertExactKeys(source, ['schemaVersion', 'deployments', 'routes'], 'system registry manifest');
  if (source.schemaVersion !== SYSTEM_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`system registry schemaVersion must be ${SYSTEM_REGISTRY_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(source.deployments) || source.deployments.length < 1 || source.deployments.length > 32) {
    throw new Error('system registry manifest must contain at least one deployment and at most 32.');
  }
  if (!Array.isArray(source.routes) || source.routes.length < 1 || source.routes.length > 256) {
    throw new Error('system registry manifest must contain at least one route and at most 256.');
  }

  const deployments = source.deployments.map(normalizeDeployment)
    .sort((left, right) => left.deploymentKey.localeCompare(right.deploymentKey));
  const deploymentByKey = new Map<string, SystemModelDeploymentManifest>();
  for (const deployment of deployments) {
    if (deploymentByKey.has(deployment.deploymentKey)) {
      throw new Error(`duplicate deploymentKey: ${deployment.deploymentKey}`);
    }
    deploymentByKey.set(deployment.deploymentKey, deployment);
  }

  const routes = source.routes.map(normalizeRoute).sort((left, right) => (
    left.taskType.localeCompare(right.taskType)
    || left.priority - right.priority
    || left.deploymentKey.localeCompare(right.deploymentKey)
  ));
  const routeKeys = new Set<string>();
  const prioritiesByTask = new Set<string>();
  const enabledByTask = new Set<string>();
  for (const route of routes) {
    const routeKey = `${route.taskType}\u0000${route.deploymentKey}`;
    if (routeKeys.has(routeKey)) throw new Error(`duplicate route: ${route.taskType}/${route.deploymentKey}`);
    routeKeys.add(routeKey);

    const priorityKey = `${route.taskType}\u0000${route.priority}`;
    if (prioritiesByTask.has(priorityKey)) {
      throw new Error(`duplicate route priority for task ${route.taskType}: ${route.priority}`);
    }
    prioritiesByTask.add(priorityKey);

    const deployment = deploymentByKey.get(route.deploymentKey);
    if (!deployment) throw new Error(`route references unknown deployment: ${route.deploymentKey}`);
    if (!deployment.taskTypes.includes(route.taskType)) {
      throw new Error(`route task is outside deployment task allowlist: ${route.taskType}/${route.deploymentKey}`);
    }
    if (route.initialEnabled && !deployment.initialEnabled) {
      throw new Error(`enabled route references a disabled deployment: ${route.taskType}/${route.deploymentKey}`);
    }
    if (route.initialEnabled) {
      if (enabledByTask.has(route.taskType)) {
        throw new Error(`task has more than one initially enabled route: ${route.taskType}`);
      }
      enabledByTask.add(route.taskType);
    }
  }

  return { schemaVersion: SYSTEM_REGISTRY_SCHEMA_VERSION, deployments, routes };
}

function normalizeDeployment(value: unknown): SystemModelDeploymentManifest {
  const source = requireRecord(value, 'model deployment');
  assertExactKeys(source, [
    'deploymentKey',
    'provider',
    'modelName',
    'modelVersion',
    'endpoint',
    'secretRef',
    'taskTypes',
    'maxConcurrency',
    'timeoutMs',
    'isLocal',
    'initialEnabled'
  ], 'model deployment');

  const deploymentKey = requirePattern(source.deploymentKey, SAFE_KEY_PATTERN, 'deploymentKey');
  if (!VALID_PROVIDERS.has(source.provider as SystemModelProvider)) {
    throw new Error(`unsupported provider for ${deploymentKey}.`);
  }
  const provider = source.provider as SystemModelProvider;
  const modelName = requireDisplayString(source.modelName, 'modelName', 256);
  const modelVersion = requireDisplayString(source.modelVersion, 'modelVersion', 128);
  const endpoint = normalizeEndpoint(source.endpoint, deploymentKey);
  const secretRef = source.secretRef === null
    ? null
    : requirePattern(source.secretRef, SECRET_REF_PATTERN, 'secretRef');
  if (!Array.isArray(source.taskTypes) || source.taskTypes.length < 1 || source.taskTypes.length > 64) {
    throw new Error(`taskTypes for ${deploymentKey} must contain between 1 and 64 entries.`);
  }
  const taskTypes = source.taskTypes
    .map((item) => requirePattern(item, TASK_TYPE_PATTERN, 'taskType'))
    .sort();
  if (new Set(taskTypes).size !== taskTypes.length) {
    throw new Error(`taskTypes for ${deploymentKey} must be unique.`);
  }
  const maxConcurrency = requireInteger(source.maxConcurrency, 1, 32, 'maxConcurrency');
  const timeoutMs = requireInteger(source.timeoutMs, 100, 300_000, 'timeoutMs');
  const isLocal = requireBoolean(source.isLocal, 'isLocal');
  const initialEnabled = requireBoolean(source.initialEnabled, 'initialEnabled');

  if (provider === 'mock' && (endpoint !== null || secretRef !== null || !isLocal)) {
    throw new Error(`mock deployment ${deploymentKey} cannot define endpoint/secretRef and must be local.`);
  }
  if (provider !== 'mock' && endpoint === null) {
    throw new Error(`non-mock deployment ${deploymentKey} requires an endpoint.`);
  }
  if (provider !== 'mock' && secretRef === null) {
    throw new Error(`non-mock deployment ${deploymentKey} requires a secretRef, never a secret value.`);
  }
  if (provider === 'local_paddle' && !isLocal) {
    throw new Error(`local_paddle deployment ${deploymentKey} must be local.`);
  }
  if (!isLocal) assertExternalEndpoint(endpoint!, deploymentKey);

  return {
    deploymentKey,
    provider,
    modelName,
    modelVersion,
    endpoint,
    secretRef,
    taskTypes,
    maxConcurrency,
    timeoutMs,
    isLocal,
    initialEnabled
  };
}

function normalizeRoute(value: unknown): SystemModelRouteManifest {
  const source = requireRecord(value, 'model route');
  assertExactKeys(source, [
    'taskType',
    'deploymentKey',
    'priority',
    'initialEnabled',
    'fallbackPolicy'
  ], 'model route');
  const fallbackPolicy = source.fallbackPolicy as SystemRouteFallbackPolicy;
  if (!VALID_FALLBACK_POLICIES.has(fallbackPolicy)) {
    throw new Error('fallbackPolicy must be manual or mock.');
  }
  return {
    taskType: requirePattern(source.taskType, TASK_TYPE_PATTERN, 'taskType'),
    deploymentKey: requirePattern(source.deploymentKey, SAFE_KEY_PATTERN, 'deploymentKey'),
    priority: requireInteger(source.priority, 1, 10_000, 'priority'),
    initialEnabled: requireBoolean(source.initialEnabled, 'initialEnabled'),
    fallbackPolicy
  };
}

function normalizeEndpoint(value: unknown, deploymentKey: string) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048 || value.trim() !== value) {
    throw new Error(`endpoint for ${deploymentKey} must be a bounded HTTP(S) URL or null.`);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`endpoint for ${deploymentKey} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error(`endpoint for ${deploymentKey} must use HTTP(S).`);
  }
  if (endpoint.username || endpoint.password) {
    throw new Error(`endpoint for ${deploymentKey} must not contain embedded credentials.`);
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error(`endpoint for ${deploymentKey} must not contain a query or fragment.`);
  }
  return endpoint.toString().replace(/\/+$/, '');
}

function assertExternalEndpoint(value: string, deploymentKey: string) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'https:') {
    throw new Error(`external deployment ${deploymentKey} must use HTTPS.`);
  }
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || isNonPublicAddress(hostname)
  ) {
    throw new Error(`external deployment ${deploymentKey} must not target a local or private address.`);
  }
}

function isNonPublicAddress(hostname: string) {
  const version = isIP(hostname);
  if (version === 4) {
    const [first, second, third] = hostname.split('.').map(Number);
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0 && (third === 0 || third === 2))
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || (first === 192 && second === 88 && third === 99)
      || (first === 198 && second === 51 && third === 100)
      || (first === 203 && second === 0 && third === 113)
      || first >= 224;
  }
  if (version === 6) {
    const normalized = hostname.toLowerCase();
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('::ffff:')
      || normalized.startsWith('64:ff9b:')
      || normalized.startsWith('100:')
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('2002:')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff');
  }
  return false;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(source: Record<string, unknown>, expected: string[], label: string) {
  const allowed = new Set(expected);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key)).sort();
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown properties: ${unknown.join(', ')}.`);
  if (missing.length > 0) throw new Error(`${label} is missing properties: ${missing.join(', ')}.`);
}

function requirePattern(value: unknown, pattern: RegExp, label: string) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} has an invalid format.`);
  }
  return value;
}

function requireDisplayString(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maxLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be a bounded non-control string.`);
  }
  return value;
}

function requireInteger(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}
