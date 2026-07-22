import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';
import { validateTargetProfile } from './target-profile.mjs';

export async function loadTargetContext({ stagingRoot, environmentPath, processEnvironment = process.env }) {
  const resolvedEnvironmentPath = resolve(stagingRoot, environmentPath ?? '.env');
  const fileEnvironment = parseEnvironmentSource(
    await readFile(resolvedEnvironmentPath, 'utf8'),
    'target environment',
  );
  const environment = { ...fileEnvironment, ...processEnvironment };
  const settings = resolveDeploymentEnvironment(environment);
  const compose = renderCompose(stagingRoot, resolvedEnvironmentPath, environment);
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
  const targetProfile = validateTargetProfile({
    settings,
    environment,
    compose,
    initialization,
    certificateFilesPresent,
    caSubject,
  });
  return {
    environment,
    environmentPath: resolvedEnvironmentPath,
    settings,
    compose,
    targetProfile,
    tlsRoot,
  };
}

function renderCompose(stagingRoot, environmentPath, environment) {
  const result = spawnSync('docker', [
    'compose', '--env-file', environmentPath, '-f', 'compose.yaml', 'config', '--format', 'json',
  ], {
    cwd: stagingRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error('Docker Compose could not render the target profile');
  return JSON.parse(result.stdout);
}
