import { ResolvedModelDeployment } from './model-deployment-config';

const MAX_HEALTH_RESPONSE_BYTES = 1024 * 1024;

export interface ModelHealthIdentity {
  modelName: string;
  modelVersion: string;
  capabilities: string[];
}

export interface ModelHealthProbeResult {
  latencyMs: number;
  identity: ModelHealthIdentity;
}

export type ModelHealthRequester = (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  operation: string
) => Promise<Response>;

export async function probeModelDeployment(
  deployment: ResolvedModelDeployment,
  secret: string | undefined,
  requester: ModelHealthRequester = defaultRequester
): Promise<ModelHealthProbeResult> {
  const startedAt = Date.now();
  if (deployment.provider === 'mock') {
    return {
      latencyMs: 0,
      identity: {
        modelName: deployment.modelName,
        modelVersion: deployment.modelVersion ?? '1',
        capabilities: deployment.taskTypes
      }
    };
  }
  if (!deployment.endpoint) throw new Error('Model endpoint is not configured');
  assertEndpoint(deployment.endpoint);
  if (!deployment.modelVersion || deployment.modelVersion === 'unverified') {
    throw new Error('Model version must be explicitly configured before enabling the deployment');
  }
  if (deployment.secretRef && !secret) throw new Error('Model authentication secret is unavailable');
  if (deployment.isLocal && !deployment.secretRef) throw new Error('Local model deployments must require authentication');

  const timeoutMs = Math.min(deployment.timeoutMs, 10_000);
  const headers: Record<string, string> = secret
    ? { Authorization: `Bearer ${secret}` }
    : {};
  const identity = deployment.provider === 'local_paddle'
    ? await probePaddle(deployment, headers, timeoutMs, requester)
    : await probeOpenAi(deployment, headers, timeoutMs, requester);
  return { latencyMs: Date.now() - startedAt, identity };
}

async function probePaddle(
  deployment: ResolvedModelDeployment,
  headers: Record<string, string>,
  timeoutMs: number,
  requester: ModelHealthRequester
) {
  const response = await requester(`${deployment.endpoint}/ready`, { method: 'GET', headers }, timeoutMs, 'ready');
  const payload = await readJson(response);
  assertOk(response, 'Paddle ready probe');
  const modelName = typeof payload.model === 'string' ? payload.model : payload.model?.name;
  const modelVersion = typeof payload.version === 'string' ? payload.version : payload.model?.version;
  const capabilities = stringArray(payload.capabilities);
  if (payload.status !== 'ready') throw new Error('Paddle provider is not ready');
  if (modelName !== deployment.modelName) throw new Error('Paddle model identity does not match the deployment');
  if (modelVersion !== deployment.modelVersion) throw new Error('Paddle model version does not match the deployment');
  if (!capabilities.includes('ocr_document')) throw new Error('Paddle provider does not declare OCR capability');
  return { modelName, modelVersion, capabilities };
}

async function probeOpenAi(
  deployment: ResolvedModelDeployment,
  headers: Record<string, string>,
  timeoutMs: number,
  requester: ModelHealthRequester
) {
  const modelsResponse = await requester(`${deployment.endpoint}/models`, { method: 'GET', headers }, timeoutMs, 'models');
  const modelsPayload = await readJson(modelsResponse);
  assertOk(modelsResponse, 'Model identity probe');
  if (!Array.isArray(modelsPayload.data) || !modelsPayload.data.some((item: unknown) => (
    Boolean(item) && typeof item === 'object' && (item as { id?: unknown }).id === deployment.modelName
  ))) {
    throw new Error('Configured model identity is absent from the provider');
  }

  let modelVersion = deployment.modelVersion!;
  if (deployment.provider === 'openai_compatible') {
    const root = deployment.endpoint!.endsWith('/v1') ? deployment.endpoint!.slice(0, -3) : deployment.endpoint!;
    const versionResponse = await requester(`${root}/version`, { method: 'GET', headers }, timeoutMs, 'version');
    const versionPayload = await readJson(versionResponse);
    assertOk(versionResponse, 'Model version probe');
    modelVersion = String(versionPayload.version ?? '');
    if (normalizeVersion(modelVersion) !== normalizeVersion(deployment.modelVersion!)) {
      throw new Error('Model runtime version does not match the deployment');
    }
  }

  const embedding = deployment.taskTypes.includes('embedding');
  const capability = embedding ? 'embeddings' : deployment.provider === 'openai' ? 'responses' : 'chat_completions';
  const capabilityUrl = embedding
    ? `${deployment.endpoint}/embeddings`
    : deployment.provider === 'openai'
      ? `${deployment.endpoint}/responses`
      : `${deployment.endpoint}/chat/completions`;
  const body = embedding
    ? { model: deployment.modelName, input: 'health' }
    : deployment.provider === 'openai'
      ? { model: deployment.modelName, input: 'health', max_output_tokens: 1 }
      : {
          model: deployment.modelName,
          messages: [{ role: 'user', content: 'health' }],
          temperature: 0,
          max_tokens: 1,
          ...(deployment.modelName.toLowerCase().includes('qwen3')
            ? { chat_template_kwargs: { enable_thinking: false } }
            : {})
        };
  const capabilityResponse = await requester(capabilityUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, timeoutMs, capability);
  const capabilityPayload = await readJson(capabilityResponse);
  assertOk(capabilityResponse, 'Model capability probe');
  if (embedding && !Array.isArray(capabilityPayload.data)) throw new Error('Embedding capability response is invalid');
  if (!embedding && deployment.provider === 'openai_compatible' && !Array.isArray(capabilityPayload.choices)) {
    throw new Error('Chat capability response is invalid');
  }
  if (!embedding && deployment.provider === 'openai' && !Array.isArray(capabilityPayload.output)) {
    throw new Error('Responses capability response is invalid');
  }
  return { modelName: deployment.modelName, modelVersion, capabilities: [capability] };
}

async function readJson(response: Response): Promise<any> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_HEALTH_RESPONSE_BYTES) throw new Error('Model health response is too large');
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_HEALTH_RESPONSE_BYTES) throw new Error('Model health response is too large');
  try {
    return body.byteLength === 0 ? {} : JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    throw new Error('Model health response is not valid JSON');
  }
}

function assertOk(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
}

function assertEndpoint(value: string) {
  const endpoint = new URL(value);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Model endpoint is not a safe HTTP endpoint');
  }
}

function normalizeVersion(value: string) {
  return value.trim().toLowerCase().replace(/^v/, '');
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function defaultRequester(url: string, init: RequestInit, timeoutMs: number) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
