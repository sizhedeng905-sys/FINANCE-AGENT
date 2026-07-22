import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRecoveryTimingEvidence,
  OffsiteBackupError,
  resolveOffsiteBackupContract,
  verifyOffsiteReplicationEvidence,
} from './offsite-backup.mjs';

const settings = { profile: 'target', environmentId: 'finance-agent-staging-cn1' };
const environment = {
  STAGING_OFFSITE_BACKUP_MODE: 'contract_only',
  STAGING_TARGET_REGION: 'cn-east-1',
  STAGING_TARGET_BACKUP_PROVIDER_CLASS: 's3_compatible',
  STAGING_TARGET_BACKUP_DESTINATION_ID: 'finance-agent-offsite-primary',
  STAGING_TARGET_BACKUP_OFFSITE_REGION: 'cn-north-2',
  STAGING_TARGET_BACKUP_FAILURE_DOMAIN_ID: 'provider-b-account-2',
  STAGING_TARGET_BACKUP_ENCRYPTION_MODE: 'sse_kms',
  STAGING_TARGET_BACKUP_KMS_KEY_ID: 'kms://provider-b/finance-agent-backup-key-v1',
  STAGING_TARGET_BACKUP_IMMUTABILITY_MODE: 'object_lock_compliance',
  STAGING_TARGET_BACKUP_REPLICATION_MODE: 'provider_replication',
  STAGING_TARGET_BACKUP_VERSIONING: 'true',
  STAGING_TARGET_BACKUP_RETENTION_POLICY_ID: 'finance-retention-pending-h14-v1',
  STAGING_TARGET_BACKUP_RPO_SECONDS: '21600',
  STAGING_TARGET_BACKUP_RTO_SECONDS: '7200',
};
const manifestSha256 = 'a'.repeat(64);

test('keeps local demo disabled and refuses an offsite mode locally', () => {
  const local = resolveOffsiteBackupContract({ settings: { profile: 'local_demo' }, environment: {} });
  assert.equal(local.status, 'disabled_local_demo');
  assert.throws(
    () => resolveOffsiteBackupContract({
      settings: { profile: 'local_demo' }, environment: { STAGING_OFFSITE_BACKUP_MODE: 'contract_only' },
    }),
    hasCode('OFFSITE_BACKUP_LOCAL_MODE_FORBIDDEN'),
  );
});

test('creates a hash-only target declaration without claiming verification', () => {
  const contract = targetContract();
  assert.equal(contract.status, 'declared_unverified');
  assert.equal(contract.acceptanceStatus, 'pending_h13_h14_h15');
  assert.equal(contract.rpoTargetSeconds, 21600);
  assert.equal(contract.rtoTargetSeconds, 7200);
  const serialized = JSON.stringify(contract);
  for (const forbidden of [
    environment.STAGING_TARGET_BACKUP_DESTINATION_ID,
    environment.STAGING_TARGET_BACKUP_KMS_KEY_ID,
    environment.STAGING_TARGET_BACKUP_FAILURE_DOMAIN_ID,
  ]) assert.equal(serialized.includes(forbidden), false);
});

test('blocks absent target declarations and rejects unsafe topology or policy values', () => {
  assert.throws(
    () => resolveOffsiteBackupContract({ settings, environment: {} }),
    hasCode('OFFSITE_BACKUP_TARGET_CONTRACT_REQUIRED', 'blocked_external'),
  );
  const cases = [
    [{ STAGING_TARGET_BACKUP_OFFSITE_REGION: environment.STAGING_TARGET_REGION }, 'OFFSITE_BACKUP_REGION_NOT_SEPARATE'],
    [{ STAGING_TARGET_BACKUP_FAILURE_DOMAIN_ID: settings.environmentId }, 'OFFSITE_BACKUP_FAILURE_DOMAIN_NOT_SEPARATE'],
    [{ STAGING_TARGET_BACKUP_ENCRYPTION_MODE: 'provider_default' }, 'OFFSITE_BACKUP_ENCRYPTION_INVALID'],
    [{ STAGING_TARGET_BACKUP_VERSIONING: undefined }, 'MISSING_STAGING_TARGET_BACKUP_VERSIONING', 'blocked_external'],
    [{ STAGING_TARGET_BACKUP_VERSIONING: 'false' }, 'OFFSITE_BACKUP_VERSIONING_REQUIRED'],
    [{ STAGING_TARGET_BACKUP_RPO_SECONDS: '000' }, 'OFFSITE_BACKUP_RPO_TARGET_INVALID'],
    [{ STAGING_TARGET_BACKUP_RETENTION_POLICY_ID: 'replace-me' }, 'INVALID_STAGING_TARGET_BACKUP_RETENTION_POLICY_ID', 'blocked_external'],
  ];
  for (const [override, code, status = 'failed'] of cases) {
    assert.throws(
      () => resolveOffsiteBackupContract({ settings, environment: { ...environment, ...override } }),
      hasCode(code, status),
    );
  }
});

test('verifies an exact synthetic replica without accepting it as target recovery', () => {
  const evidence = verifyOffsiteReplicationEvidence({ contract: targetContract(), attempt: replicaAttempt() });
  assert.equal(evidence.status, 'verified_unaccepted');
  assert.equal(evidence.scope, 'synthetic');
  assert.equal(evidence.objectCount, 42);
  assert.equal(evidence.durationSeconds, 60);
});

test('fails closed on partial, manifest, count, byte, encryption and immutability faults', () => {
  const cases = [
    [{ replicationStatus: 'partial' }, 'OFFSITE_REPLICATION_INCOMPLETE'],
    [{ destinationManifestSha256: 'b'.repeat(64) }, 'OFFSITE_REPLICATION_MANIFEST_MISMATCH'],
    [{ destinationObjectCount: 41 }, 'OFFSITE_REPLICATION_OBJECT_COUNT_MISMATCH'],
    [{ destinationBytes: 999 }, 'OFFSITE_REPLICATION_BYTES_MISMATCH'],
    [{ kmsKeyId: 'kms://wrong/key' }, 'OFFSITE_REPLICATION_ENCRYPTION_MISMATCH'],
    [{ versioningEnabled: false }, 'OFFSITE_REPLICATION_IMMUTABILITY_MISMATCH'],
    [{ immutabilityMode: 'object_lock_governance' }, 'OFFSITE_REPLICATION_IMMUTABILITY_MISMATCH'],
    [{ sourceRecoverablePointAt: '2026-07-22T00:00:01Z' }, 'OFFSITE_REPLICATION_TIME_ORDER_INVALID'],
    [{ finishedAt: '2026-07-21T23:59:59Z' }, 'OFFSITE_REPLICATION_TIME_ORDER_INVALID'],
  ];
  for (const [override, code] of cases) {
    assert.throws(
      () => verifyOffsiteReplicationEvidence({ contract: targetContract(), attempt: { ...replicaAttempt(), ...override } }),
      hasCode(code),
    );
  }
});

test('calculates RPO and RTO from an ordered synthetic timeline', () => {
  const contract = targetContract();
  const replicationEvidence = verifyOffsiteReplicationEvidence({ contract, attempt: replicaAttempt() });
  const evidence = createRecoveryTimingEvidence({
    contract,
    replicationEvidence,
    measurement: {
      scope: 'synthetic',
      failureDetectedAt: '2026-07-22T01:00:00Z',
      recoveryStartedAt: '2026-07-22T01:05:00Z',
      verificationCompletedAt: '2026-07-22T02:00:00Z',
    },
  });
  assert.equal(evidence.status, 'measured_within_declared_target');
  assert.deepEqual(evidence.rpo, { measuredSeconds: 3600, declaredTargetSeconds: 21600, status: 'within_declared_target' });
  assert.deepEqual(evidence.rto, { measuredSeconds: 3600, declaredTargetSeconds: 7200, status: 'within_declared_target' });
  assert.equal(evidence.acceptanceStatus, 'pending_h14_h15');
});

test('reports threshold overruns without converting them into acceptance', () => {
  const contract = targetContract();
  const replicationEvidence = verifyOffsiteReplicationEvidence({
    contract,
    attempt: { ...replicaAttempt(), sourceRecoverablePointAt: '2026-07-20T00:00:00Z' },
  });
  const evidence = createRecoveryTimingEvidence({
    contract,
    replicationEvidence,
    measurement: {
      scope: 'synthetic',
      failureDetectedAt: '2026-07-22T00:02:00Z',
      recoveryStartedAt: '2026-07-22T00:10:00Z',
      verificationCompletedAt: '2026-07-22T03:00:00Z',
    },
  });
  assert.equal(evidence.status, 'measured_exceeds_declared_target');
  assert.equal(evidence.rpo.status, 'exceeds_declared_target');
  assert.equal(evidence.rto.status, 'exceeds_declared_target');
});

test('rejects mixed contracts, scope escalation, extra fields and invalid chronology', () => {
  const contract = targetContract();
  const replicationEvidence = verifyOffsiteReplicationEvidence({ contract, attempt: replicaAttempt() });
  const base = {
    scope: 'synthetic',
    failureDetectedAt: '2026-07-22T01:00:00Z',
    recoveryStartedAt: '2026-07-22T01:05:00Z',
    verificationCompletedAt: '2026-07-22T02:00:00Z',
  };
  assert.throws(
    () => createRecoveryTimingEvidence({ contract, replicationEvidence, measurement: { ...base, scope: 'target_live' } }),
    hasCode('RECOVERY_TIMING_SCOPE_INVALID'),
  );
  assert.throws(
    () => createRecoveryTimingEvidence({ contract, replicationEvidence, measurement: { ...base, unexpected: true } }),
    hasCode('OFFSITE_EVIDENCE_SHAPE_INVALID'),
  );
  assert.throws(
    () => createRecoveryTimingEvidence({
      contract,
      replicationEvidence,
      measurement: { ...base, recoveryStartedAt: '2026-07-21T23:59:59Z' },
    }),
    hasCode('RECOVERY_TIMING_TIME_ORDER_INVALID'),
  );
  assert.throws(
    () => createRecoveryTimingEvidence({
      contract,
      replicationEvidence,
      measurement: { ...base, failureDetectedAt: '2026-07-22T00:00:30Z' },
    }),
    hasCode('RECOVERY_TIMING_TIME_ORDER_INVALID'),
  );
  assert.throws(
    () => createRecoveryTimingEvidence({
      contract: resolveOffsiteBackupContract({
        settings,
        environment: { ...environment, STAGING_TARGET_BACKUP_RTO_SECONDS: '8000' },
      }),
      replicationEvidence,
      measurement: base,
    }),
    hasCode('RECOVERY_TIMING_REPLICATION_EVIDENCE_INVALID'),
  );
});

function targetContract() {
  return resolveOffsiteBackupContract({ settings, environment });
}

function replicaAttempt() {
  return {
    scope: 'synthetic',
    replicationStatus: 'complete',
    sourceManifestSha256: manifestSha256,
    destinationManifestSha256: manifestSha256,
    sourceObjectCount: 42,
    destinationObjectCount: 42,
    sourceBytes: 123456,
    destinationBytes: 123456,
    encryptionMode: environment.STAGING_TARGET_BACKUP_ENCRYPTION_MODE,
    kmsKeyId: environment.STAGING_TARGET_BACKUP_KMS_KEY_ID,
    immutabilityMode: environment.STAGING_TARGET_BACKUP_IMMUTABILITY_MODE,
    versioningEnabled: true,
    sourceRecoverablePointAt: '2026-07-22T00:00:00Z',
    startedAt: '2026-07-22T00:00:00Z',
    finishedAt: '2026-07-22T00:01:00Z',
  };
}

function hasCode(code, status = 'failed') {
  return (error) => error instanceof OffsiteBackupError && error.code === code && error.status === status;
}
