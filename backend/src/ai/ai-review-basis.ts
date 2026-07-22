import { canonicalJsonSha256 } from '../common/utils/canonical-json';

export const AI_REVIEW_BASIS_SCHEMA_VERSION = 'ai-review-basis/1.0';

export interface AiReviewStateToken {
  schemaVersion: string;
  stateHash: string;
}

export interface AiReviewBasisInput {
  taskType: string;
  resourceType: string;
  resourceId: string;
  aiTaskId: string;
  reviewState: AiReviewStateToken;
  inputHash: string;
  outputHash: string;
  versionVectorHash: string;
}

export interface AiReviewBasis extends AiReviewBasisInput {
  schemaVersion: typeof AI_REVIEW_BASIS_SCHEMA_VERSION;
  basisHash: string;
}

export function buildAiReviewBasis(input: AiReviewBasisInput): AiReviewBasis {
  assertIdentifier(input.taskType, 'taskType');
  assertIdentifier(input.resourceType, 'resourceType');
  assertIdentifier(input.resourceId, 'resourceId');
  assertIdentifier(input.aiTaskId, 'aiTaskId');
  assertIdentifier(input.reviewState.schemaVersion, 'reviewState.schemaVersion');
  assertSha256(input.reviewState.stateHash, 'reviewState.stateHash');
  assertSha256(input.inputHash, 'inputHash');
  assertSha256(input.outputHash, 'outputHash');
  assertSha256(input.versionVectorHash, 'versionVectorHash');

  const core: Omit<AiReviewBasis, 'basisHash'> = {
    schemaVersion: AI_REVIEW_BASIS_SCHEMA_VERSION,
    ...input
  };
  return { ...core, basisHash: canonicalJsonSha256(core) };
}

function assertSha256(value: string, path: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${path} must be a canonical SHA-256`);
}

function assertIdentifier(value: string, path: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)) {
    throw new TypeError(`${path} must be a stable identifier`);
  }
}
