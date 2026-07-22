import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';
import { TargetProfileError, validateTargetProfile } from './target-profile.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const environmentPath = resolve(stagingRoot, optionValue(arguments_, '--env-file') ?? '.env');
const evidenceRoot = join(stagingRoot, '.evidence');

try {
  const fileEnvironment = parseEnvironmentSource(
    await readFile(environmentPath, 'utf8'),
    'target environment',
  );
  const environment = { ...fileEnvironment, ...process.env };
  const settings = resolveDeploymentEnvironment(environment);
  const compose = renderCompose(environmentPath, environment);
  const tlsRoot = join(stagingRoot, '.runtime', 'tls');
  const certificateFilesPresent = ['ca.crt', 'gateway.crt', 'gateway.key', 'postgres.crt', 'postgres.key']
    .filter((name) => existsSync(join(tlsRoot, name)));
  const caSubject = certificateFilesPresent.includes('ca.crt')
    ? new X509Certificate(await readFile(join(tlsRoot, 'ca.crt'))).subject
    : '';
  const initializationPath = join(stagingRoot, '.runtime', 'initialization.json');
  const initialization = existsSync(initializationPath)
    ? JSON.parse(await readFile(initializationPath, 'utf8'))
    : null;
  const result = {
    ...validateTargetProfile({
      settings,
      environment,
      compose,
      initialization,
      certificateFilesPresent,
      caSubject,
    }),
    checkedAt: new Date().toISOString(),
  };
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(evidenceRoot, 'target-profile-check.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const result = {
    schemaVersion: 'staging-target-profile/1.0',
    status: 'blocked_external',
    errorCode: error instanceof TargetProfileError ? error.code : 'TARGET_PROFILE_CHECK_FAILED',
    message: safeMessage(error),
    checkedAt: new Date().toISOString(),
  };
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 2;
}

function renderCompose(environmentPath_, environment) {
  const result = spawnSync('docker', [
    'compose', '--env-file', environmentPath_, '-f', 'compose.yaml', 'config', '--format', 'json',
  ], {
    cwd: stagingRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error('Docker Compose could not render the target profile');
  return JSON.parse(result.stdout);
}

function optionValue(arguments__, option) {
  const index = arguments__.indexOf(option);
  if (index === -1) return null;
  const value = arguments__[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function safeMessage(error) {
  if (error instanceof TargetProfileError) return error.message;
  if (error instanceof Error && /ENOENT/.test(error.message)) return 'A required target profile file is missing';
  return 'Target profile validation could not complete';
}
