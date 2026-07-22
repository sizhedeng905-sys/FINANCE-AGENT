import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';
import {
  OFFSITE_BACKUP_CONTRACT_SCHEMA,
  OffsiteBackupError,
  resolveOffsiteBackupContract,
} from './offsite-backup.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = join(stagingRoot, '.evidence');
let result;

try {
  const fileEnvironment = parseEnvironmentSource(
    await readFile(join(stagingRoot, '.env'), 'utf8'),
    'staging environment',
  );
  const environment = { ...fileEnvironment, ...process.env };
  const settings = resolveDeploymentEnvironment(environment);
  const contract = resolveOffsiteBackupContract({ settings, environment });
  result = contract.status === 'disabled_local_demo'
    ? contract
    : Object.freeze({
        ...contract,
        status: 'blocked_external',
        errorCode: 'OFFSITE_BACKUP_REAL_REPLICATION_AND_RESTORE_EVIDENCE_REQUIRED',
      });
} catch (error) {
  const known = error instanceof OffsiteBackupError;
  result = Object.freeze({
    schemaVersion: OFFSITE_BACKUP_CONTRACT_SCHEMA,
    status: known ? error.status : 'failed',
    errorCode: known ? error.code : 'OFFSITE_BACKUP_CONTRACT_CHECK_FAILED',
  });
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const evidencePath = join(evidenceRoot, 'offsite-backup-contract.json');
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
const summary = {
  schemaVersion: result.schemaVersion,
  status: result.status,
  errorCode: result.errorCode ?? null,
  contractSha256: result.contractSha256 ?? null,
  acceptanceStatus: result.acceptanceStatus ?? null,
  evidencePath: '.evidence/offsite-backup-contract.json',
};
const output = `${JSON.stringify(summary, null, 2)}\n`;
if (result.status === 'disabled_local_demo') process.stdout.write(output);
else process.stderr.write(output);
process.exitCode = result.status === 'disabled_local_demo' ? 0 : result.status === 'blocked_external' ? 2 : 1;
