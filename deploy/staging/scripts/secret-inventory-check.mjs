import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';
import {
  assertSecretInventoryGate,
  buildSecretInventory,
  collectSecretFileMetadata,
  SECRET_INVENTORY_SCHEMA,
  SecretLifecycleError,
  validateSecretPolicy,
} from './secret-lifecycle.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = join(stagingRoot, '.evidence');
let result;

try {
  const policy = JSON.parse(await readFile(join(stagingRoot, 'secret-policy.json'), 'utf8'));
  const fileEnvironment = parseEnvironmentSource(
    await readFile(join(stagingRoot, '.env'), 'utf8'),
    'staging environment',
  );
  const environment = { ...fileEnvironment, ...process.env };
  const settings = resolveDeploymentEnvironment(environment);
  const compose = renderCompose(environment);
  const validated = validateSecretPolicy(policy, compose);
  const fileMetadata = await collectSecretFileMetadata(
    join(stagingRoot, '.secrets'),
    [...validated.secrets.keys()],
  );
  result = buildSecretInventory({
    policy,
    compose,
    fileMetadata,
    profile: settings.profile,
  });
  assertSecretInventoryGate(result);
} catch (error) {
  result = failureResult(error);
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const evidencePath = join(evidenceRoot, 'secret-inventory.json');
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
const summary = {
  schemaVersion: result.schemaVersion,
  status: result.status,
  errorCode: result.errorCode ?? null,
  secretCount: result.secretCount ?? 0,
  counts: result.counts ?? null,
  policySha256: result.policySha256 ?? null,
  inventorySha256: result.inventorySha256 ?? null,
  evidencePath: '.evidence/secret-inventory.json',
};
const output = `${JSON.stringify(summary, null, 2)}\n`;
if (result.status === 'passed' || result.status === 'warning') process.stdout.write(output);
else process.stderr.write(output);
process.exitCode = result.status === 'passed' || result.status === 'warning'
  ? 0
  : result.status === 'blocked_external' ? 2 : 1;

function renderCompose(environment) {
  const rendered = spawnSync('docker', [
    'compose', '--env-file', '.env', '-f', 'compose.yaml', 'config', '--format', 'json',
  ], {
    cwd: stagingRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (rendered.status !== 0) throw new SecretLifecycleError('SECRET_INVENTORY_COMPOSE_RENDER_FAILED');
  try {
    return JSON.parse(rendered.stdout);
  } catch {
    throw new SecretLifecycleError('SECRET_INVENTORY_COMPOSE_OUTPUT_INVALID');
  }
}

function failureResult(error) {
  const known = error instanceof SecretLifecycleError;
  return Object.freeze({
    schemaVersion: SECRET_INVENTORY_SCHEMA,
    status: known ? error.status : 'failed',
    errorCode: known ? error.code : 'SECRET_INVENTORY_CHECK_FAILED',
    secretCount: 0,
    counts: null,
  });
}
