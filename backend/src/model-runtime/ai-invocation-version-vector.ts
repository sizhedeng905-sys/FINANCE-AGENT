import { canonicalJsonSha256 } from '../common/utils/canonical-json';

export const AI_INVOCATION_VECTOR_VERSION = 'ai-invocation-vector/1.2';

export interface AiInvocationVersionVectorInput {
  source: {
    kind: 'excel' | 'ocr' | 'report-snapshot';
    sourceId: string;
    sourceSha256: string;
    irHash: string;
    irSchemaVersion: string;
    processorVersion: string;
  };
  template: {
    templateVersionId: string;
    templateContentSha256: string;
    candidateSetSha256: string;
  };
  prompt: {
    promptKey: string;
    versionNo: number;
    contentSha256: string;
    bundleSha256: string;
    executionSha256: string;
  };
  contracts: {
    inputSchemaVersion: string;
    outputSchemaVersion: string;
    outputSchemaSha256: string;
  };
  provider: {
    providerClass: 'mock' | 'local' | 'external';
    provider: string;
    deploymentId: string | null;
    modelConfigId: string | null;
    modelName: string;
    modelRevision: string | null;
    configSha256: string;
  };
  transformRegistryVersion: string;
  validationRuleVersion: string;
  mappingProfileVersion: string | null;
  redactionPolicyVersion: string;
  authorizationPolicyVersion: string;
  featurePolicyVersion: string;
  featurePolicySnapshotSha256: string;
  reviewStateSha256: string | null;
  inputSha256: string;
}

export interface AiInvocationVersionVector extends AiInvocationVersionVectorInput {
  schemaVersion: typeof AI_INVOCATION_VECTOR_VERSION;
  vectorSha256: string;
}

export function buildAiInvocationVersionVector(input: AiInvocationVersionVectorInput): AiInvocationVersionVector {
  validateVersionVectorInput(input);
  const content: AiInvocationVersionVectorInput & { schemaVersion: typeof AI_INVOCATION_VECTOR_VERSION } = {
    schemaVersion: AI_INVOCATION_VECTOR_VERSION,
    ...input
  };
  return { ...content, vectorSha256: canonicalJsonSha256(content) };
}

export function aiInvocationVersionVectorContent(vector: AiInvocationVersionVector) {
  const { vectorSha256: _vectorSha256, ...content } = vector;
  return content;
}

export function completeAiInvocationVersionVector(vector: AiInvocationVersionVector, outputSha256: string) {
  assertSha256(outputSha256, 'outputSha256');
  const completion = {
    schemaVersion: 'ai-invocation-completion/1.0' as const,
    vectorSha256: vector.vectorSha256,
    outputSha256
  };
  return { ...completion, completionSha256: canonicalJsonSha256(completion) };
}

function validateVersionVectorInput(input: AiInvocationVersionVectorInput) {
  assertIdentifier(input.source.sourceId, 'source.sourceId');
  assertSha256(input.source.sourceSha256, 'source.sourceSha256');
  assertSha256(input.source.irHash, 'source.irHash');
  assertVersion(input.source.irSchemaVersion, 'source.irSchemaVersion');
  assertVersion(input.source.processorVersion, 'source.processorVersion');

  assertIdentifier(input.template.templateVersionId, 'template.templateVersionId');
  assertSha256(input.template.templateContentSha256, 'template.templateContentSha256');
  assertSha256(input.template.candidateSetSha256, 'template.candidateSetSha256');

  assertIdentifier(input.prompt.promptKey, 'prompt.promptKey');
  if (!Number.isInteger(input.prompt.versionNo) || input.prompt.versionNo < 1) {
    throw new TypeError('prompt.versionNo must be a positive integer');
  }
  assertSha256(input.prompt.contentSha256, 'prompt.contentSha256');
  assertSha256(input.prompt.bundleSha256, 'prompt.bundleSha256');
  assertSha256(input.prompt.executionSha256, 'prompt.executionSha256');
  assertVersion(input.contracts.inputSchemaVersion, 'contracts.inputSchemaVersion');
  assertVersion(input.contracts.outputSchemaVersion, 'contracts.outputSchemaVersion');
  assertSha256(input.contracts.outputSchemaSha256, 'contracts.outputSchemaSha256');

  assertIdentifier(input.provider.provider, 'provider.provider');
  assertIdentifier(input.provider.modelName, 'provider.modelName');
  if (input.provider.deploymentId !== null) assertIdentifier(input.provider.deploymentId, 'provider.deploymentId');
  if (input.provider.modelConfigId !== null) assertIdentifier(input.provider.modelConfigId, 'provider.modelConfigId');
  if (input.provider.modelRevision !== null) assertVersion(input.provider.modelRevision, 'provider.modelRevision');
  assertSha256(input.provider.configSha256, 'provider.configSha256');

  assertVersion(input.transformRegistryVersion, 'transformRegistryVersion');
  assertVersion(input.validationRuleVersion, 'validationRuleVersion');
  if (input.mappingProfileVersion !== null) assertVersion(input.mappingProfileVersion, 'mappingProfileVersion');
  assertVersion(input.redactionPolicyVersion, 'redactionPolicyVersion');
  assertVersion(input.authorizationPolicyVersion, 'authorizationPolicyVersion');
  assertVersion(input.featurePolicyVersion, 'featurePolicyVersion');
  assertSha256(input.featurePolicySnapshotSha256, 'featurePolicySnapshotSha256');
  if (input.reviewStateSha256 !== null) assertSha256(input.reviewStateSha256, 'reviewStateSha256');
  assertSha256(input.inputSha256, 'inputSha256');
}

function assertSha256(value: string, path: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${path} must be a canonical SHA-256`);
}

function assertVersion(value: string, path: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/.test(value)) {
    throw new TypeError(`${path} must be a stable version identifier`);
  }
}

function assertIdentifier(value: string, path: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)) {
    throw new TypeError(`${path} must be a stable identifier`);
  }
}
