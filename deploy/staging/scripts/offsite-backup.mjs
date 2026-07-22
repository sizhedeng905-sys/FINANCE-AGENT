import { createHash } from 'node:crypto';

export const OFFSITE_BACKUP_CONTRACT_SCHEMA = 'staging-offsite-backup-contract/1.0';
export const OFFSITE_REPLICATION_EVIDENCE_SCHEMA = 'staging-offsite-replication-evidence/1.0';
export const RECOVERY_TIMING_EVIDENCE_SCHEMA = 'staging-recovery-timing-evidence/1.0';

const providerClasses = new Set(['aws_s3', 'azure_blob', 'gcs', 's3_compatible']);
const encryptionModes = new Set(['client_side_envelope', 'sse_kms']);
const immutabilityModes = new Set(['object_lock_compliance', 'object_lock_governance', 'provider_immutable']);
const replicationModes = new Set(['backup_agent_copy', 'provider_replication']);
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@\/-]{2,191}$/;
const placeholderPattern = /(?:^|[-_.])(required|replace|todo|tbd|changeme|placeholder|example)(?:$|[-_.])/i;

export class OffsiteBackupError extends Error {
  constructor(code, status = 'failed') {
    super(code);
    this.name = 'OffsiteBackupError';
    this.code = code;
    this.status = status;
  }
}

export function resolveOffsiteBackupContract({ settings, environment }) {
  if (!settings || !['local_demo', 'target'].includes(settings.profile)) fail('OFFSITE_BACKUP_PROFILE_INVALID');
  const mode = String(environment.STAGING_OFFSITE_BACKUP_MODE ?? 'disabled').trim();
  if (settings.profile === 'local_demo') {
    if (mode !== 'disabled') fail('OFFSITE_BACKUP_LOCAL_MODE_FORBIDDEN');
    return Object.freeze({
      schemaVersion: OFFSITE_BACKUP_CONTRACT_SCHEMA,
      status: 'disabled_local_demo',
      acceptanceStatus: 'not_applicable',
      contractSha256: sha256('disabled_local_demo'),
    });
  }
  if (mode !== 'contract_only') blocked('OFFSITE_BACKUP_TARGET_CONTRACT_REQUIRED');

  const requiredValue = (key) => {
    const value = String(environment[key] ?? '').trim();
    if (!value) blocked(`MISSING_${key}`);
    if (placeholderPattern.test(value) || value.length > 191 || /[\0\r\n]/.test(value)) blocked(`INVALID_${key}`);
    return value;
  };
  const requiredId = (key) => {
    const value = requiredValue(key);
    if (!safeIdPattern.test(value)) blocked(`INVALID_${key}`);
    return value;
  };
  const providerClass = enumValue(requiredId('STAGING_TARGET_BACKUP_PROVIDER_CLASS'), providerClasses, 'OFFSITE_BACKUP_PROVIDER_INVALID');
  const destinationId = requiredId('STAGING_TARGET_BACKUP_DESTINATION_ID');
  const targetRegion = requiredId('STAGING_TARGET_REGION');
  const offsiteRegion = requiredId('STAGING_TARGET_BACKUP_OFFSITE_REGION');
  if (offsiteRegion.toLowerCase() === targetRegion.toLowerCase()) fail('OFFSITE_BACKUP_REGION_NOT_SEPARATE');
  const failureDomainId = requiredId('STAGING_TARGET_BACKUP_FAILURE_DOMAIN_ID');
  if ([settings.environmentId, targetRegion, destinationId].some((value) => failureDomainId.toLowerCase() === String(value).toLowerCase())) {
    fail('OFFSITE_BACKUP_FAILURE_DOMAIN_NOT_SEPARATE');
  }
  const encryptionMode = enumValue(requiredId('STAGING_TARGET_BACKUP_ENCRYPTION_MODE'), encryptionModes, 'OFFSITE_BACKUP_ENCRYPTION_INVALID');
  const kmsKeyId = requiredId('STAGING_TARGET_BACKUP_KMS_KEY_ID');
  const immutabilityMode = enumValue(requiredId('STAGING_TARGET_BACKUP_IMMUTABILITY_MODE'), immutabilityModes, 'OFFSITE_BACKUP_IMMUTABILITY_INVALID');
  const replicationMode = enumValue(requiredId('STAGING_TARGET_BACKUP_REPLICATION_MODE'), replicationModes, 'OFFSITE_BACKUP_REPLICATION_MODE_INVALID');
  if (requiredValue('STAGING_TARGET_BACKUP_VERSIONING') !== 'true') {
    fail('OFFSITE_BACKUP_VERSIONING_REQUIRED');
  }
  const retentionPolicyId = requiredId('STAGING_TARGET_BACKUP_RETENTION_POLICY_ID');
  const rpoTargetSeconds = integer(
    requiredValue('STAGING_TARGET_BACKUP_RPO_SECONDS'), 60, 604_800, 'OFFSITE_BACKUP_RPO_TARGET_INVALID',
  );
  const rtoTargetSeconds = integer(
    requiredValue('STAGING_TARGET_BACKUP_RTO_SECONDS'), 60, 604_800, 'OFFSITE_BACKUP_RTO_TARGET_INVALID',
  );
  const facts = {
    schemaVersion: OFFSITE_BACKUP_CONTRACT_SCHEMA,
    status: 'declared_unverified',
    acceptanceStatus: 'pending_h13_h14_h15',
    providerClass,
    destinationIdSha256: sha256(destinationId),
    targetRegionSha256: sha256(targetRegion.toLowerCase()),
    offsiteRegionSha256: sha256(offsiteRegion.toLowerCase()),
    failureDomainIdSha256: sha256(failureDomainId),
    encryption: {
      mode: encryptionMode,
      transport: 'tls_1_2_plus_required',
      kmsKeyIdSha256: sha256(kmsKeyId),
      declarationStatus: 'declared_not_cryptographically_verified',
    },
    immutability: {
      mode: immutabilityMode,
      versioningRequired: true,
      retentionPolicyIdSha256: sha256(retentionPolicyId),
      declarationStatus: 'declared_not_provider_verified',
    },
    replicationMode,
    rpoTargetSeconds,
    rtoTargetSeconds,
  };
  return Object.freeze({ ...facts, contractSha256: sha256(canonicalJson(facts)) });
}

export function verifyOffsiteReplicationEvidence({ contract, attempt }) {
  requireTargetContract(contract);
  assertExactKeys(attempt, [
    'destinationBytes', 'destinationManifestSha256', 'destinationObjectCount', 'encryptionMode',
    'finishedAt', 'immutabilityMode', 'kmsKeyId', 'replicationStatus', 'scope', 'sourceBytes',
    'sourceManifestSha256', 'sourceObjectCount', 'sourceRecoverablePointAt', 'startedAt', 'versioningEnabled',
  ]);
  if (!['synthetic', 'target_isolated'].includes(attempt.scope)) fail('OFFSITE_REPLICATION_SCOPE_INVALID');
  if (attempt.replicationStatus !== 'complete') fail('OFFSITE_REPLICATION_INCOMPLETE');
  for (const hash of [attempt.sourceManifestSha256, attempt.destinationManifestSha256]) assertSha256(hash);
  if (attempt.sourceManifestSha256 !== attempt.destinationManifestSha256) fail('OFFSITE_REPLICATION_MANIFEST_MISMATCH');
  const sourceObjectCount = integer(attempt.sourceObjectCount, 0, 50_000_000, 'OFFSITE_REPLICATION_OBJECT_COUNT_INVALID');
  const destinationObjectCount = integer(attempt.destinationObjectCount, 0, 50_000_000, 'OFFSITE_REPLICATION_OBJECT_COUNT_INVALID');
  if (sourceObjectCount !== destinationObjectCount) fail('OFFSITE_REPLICATION_OBJECT_COUNT_MISMATCH');
  const sourceBytes = integer(attempt.sourceBytes, 0, Number.MAX_SAFE_INTEGER, 'OFFSITE_REPLICATION_BYTES_INVALID');
  const destinationBytes = integer(attempt.destinationBytes, 0, Number.MAX_SAFE_INTEGER, 'OFFSITE_REPLICATION_BYTES_INVALID');
  if (sourceBytes !== destinationBytes) fail('OFFSITE_REPLICATION_BYTES_MISMATCH');
  if (attempt.encryptionMode !== contract.encryption.mode
    || sha256(String(attempt.kmsKeyId ?? '')) !== contract.encryption.kmsKeyIdSha256) {
    fail('OFFSITE_REPLICATION_ENCRYPTION_MISMATCH');
  }
  if (attempt.immutabilityMode !== contract.immutability.mode || attempt.versioningEnabled !== true) {
    fail('OFFSITE_REPLICATION_IMMUTABILITY_MISMATCH');
  }
  const sourceRecoverablePointAt = timestamp(attempt.sourceRecoverablePointAt, 'OFFSITE_REPLICATION_TIME_INVALID');
  const startedAt = timestamp(attempt.startedAt, 'OFFSITE_REPLICATION_TIME_INVALID');
  const finishedAt = timestamp(attempt.finishedAt, 'OFFSITE_REPLICATION_TIME_INVALID');
  if (!(sourceRecoverablePointAt <= startedAt && startedAt <= finishedAt)) {
    fail('OFFSITE_REPLICATION_TIME_ORDER_INVALID');
  }
  return Object.freeze({
    schemaVersion: OFFSITE_REPLICATION_EVIDENCE_SCHEMA,
    status: 'verified_unaccepted',
    scope: attempt.scope,
    acceptanceStatus: 'pending_h13_h14_h15',
    contractSha256: contract.contractSha256,
    manifestSha256: attempt.sourceManifestSha256,
    objectCount: sourceObjectCount,
    totalBytes: sourceBytes,
    sourceRecoverablePointAt: new Date(sourceRecoverablePointAt).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationSeconds: Math.ceil((finishedAt - startedAt) / 1000),
    encryptionDeclarationMatched: true,
    immutabilityDeclarationMatched: true,
  });
}

export function createRecoveryTimingEvidence({ contract, replicationEvidence, measurement }) {
  requireTargetContract(contract);
  if (replicationEvidence?.schemaVersion !== OFFSITE_REPLICATION_EVIDENCE_SCHEMA
    || replicationEvidence.status !== 'verified_unaccepted'
    || replicationEvidence.contractSha256 !== contract.contractSha256) {
    fail('RECOVERY_TIMING_REPLICATION_EVIDENCE_INVALID');
  }
  assertExactKeys(measurement, [
    'failureDetectedAt', 'recoveryStartedAt', 'scope', 'verificationCompletedAt',
  ]);
  if (measurement.scope !== replicationEvidence.scope || !['synthetic', 'target_isolated'].includes(measurement.scope)) {
    fail('RECOVERY_TIMING_SCOPE_INVALID');
  }
  const recoverablePointAt = timestamp(replicationEvidence.sourceRecoverablePointAt, 'RECOVERY_TIMING_TIME_INVALID');
  const replicaFinishedAt = timestamp(replicationEvidence.finishedAt, 'RECOVERY_TIMING_TIME_INVALID');
  const failureDetectedAt = timestamp(measurement.failureDetectedAt, 'RECOVERY_TIMING_TIME_INVALID');
  const recoveryStartedAt = timestamp(measurement.recoveryStartedAt, 'RECOVERY_TIMING_TIME_INVALID');
  const verificationCompletedAt = timestamp(measurement.verificationCompletedAt, 'RECOVERY_TIMING_TIME_INVALID');
  if (!(recoverablePointAt <= replicaFinishedAt
    && replicaFinishedAt <= failureDetectedAt
    && failureDetectedAt <= recoveryStartedAt
    && recoveryStartedAt <= verificationCompletedAt)) {
    fail('RECOVERY_TIMING_TIME_ORDER_INVALID');
  }
  const rpoSeconds = Math.ceil((failureDetectedAt - recoverablePointAt) / 1000);
  const rtoSeconds = Math.ceil((verificationCompletedAt - failureDetectedAt) / 1000);
  const rpoStatus = rpoSeconds <= contract.rpoTargetSeconds ? 'within_declared_target' : 'exceeds_declared_target';
  const rtoStatus = rtoSeconds <= contract.rtoTargetSeconds ? 'within_declared_target' : 'exceeds_declared_target';
  return Object.freeze({
    schemaVersion: RECOVERY_TIMING_EVIDENCE_SCHEMA,
    status: rpoStatus === 'within_declared_target' && rtoStatus === 'within_declared_target'
      ? 'measured_within_declared_target'
      : 'measured_exceeds_declared_target',
    scope: measurement.scope,
    acceptanceStatus: 'pending_h14_h15',
    contractSha256: contract.contractSha256,
    replicationManifestSha256: replicationEvidence.manifestSha256,
    rpo: { measuredSeconds: rpoSeconds, declaredTargetSeconds: contract.rpoTargetSeconds, status: rpoStatus },
    rto: { measuredSeconds: rtoSeconds, declaredTargetSeconds: contract.rtoTargetSeconds, status: rtoStatus },
    recoverablePointAt: new Date(recoverablePointAt).toISOString(),
    failureDetectedAt: new Date(failureDetectedAt).toISOString(),
    recoveryStartedAt: new Date(recoveryStartedAt).toISOString(),
    verificationCompletedAt: new Date(verificationCompletedAt).toISOString(),
  });
}

function requireTargetContract(contract) {
  if (contract?.schemaVersion !== OFFSITE_BACKUP_CONTRACT_SCHEMA
    || contract.status !== 'declared_unverified'
    || !/^[a-f0-9]{64}$/.test(String(contract.contractSha256 ?? ''))) {
    fail('OFFSITE_BACKUP_CONTRACT_INVALID');
  }
}

function assertExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('OFFSITE_EVIDENCE_SHAPE_INVALID');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('OFFSITE_EVIDENCE_SHAPE_INVALID');
  }
}

function enumValue(value, allowed, code) {
  if (!allowed.has(value)) fail(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(code);
  return parsed;
}

function assertSha256(value) {
  if (!/^[a-f0-9]{64}$/.test(String(value ?? ''))) fail('OFFSITE_REPLICATION_MANIFEST_HASH_INVALID');
}

function timestamp(value, code) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function blocked(code) {
  throw new OffsiteBackupError(code, 'blocked_external');
}

function fail(code) {
  throw new OffsiteBackupError(code);
}
