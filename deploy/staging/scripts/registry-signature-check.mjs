import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTargetContext } from './target-context.mjs';
import { TargetProfileError } from './target-profile.mjs';
import {
  collectComposeSignatureTargets,
  createCosignAdapter,
  readPublicKeyFile,
  REGISTRY_SIGNATURE_SCHEMA,
  RegistrySignatureError,
  verifyRegistrySignatures,
} from './registry-signature.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const environmentPath = optionValue(arguments_, '--env-file') ?? '.env';
const evidenceRoot = join(stagingRoot, '.evidence');
const publicKeyPath = join(stagingRoot, '.secrets', 'cosign.pub');
let result;

try {
  const context = await loadTargetContext({ stagingRoot, environmentPath });
  const publicKey = await readPublicKeyFile(publicKeyPath);
  result = await verifyRegistrySignatures({
    targets: collectComposeSignatureTargets(context.compose, context.settings.registryPrefix),
    registryPrefix: context.settings.registryPrefix,
    publicKey,
    publicKeyPath,
    signaturePolicy: context.environment.STAGING_TARGET_SIGNATURE_POLICY,
    registryAuthMode: context.environment.STAGING_TARGET_REGISTRY_AUTH_MODE,
    adapter: createCosignAdapter(),
  });
} catch (error) {
  result = blockedResult(error);
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const evidenceId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const evidencePath = join(evidenceRoot, `registry-signature-${evidenceId}.json`);
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

const summary = {
  schemaVersion: result.schemaVersion,
  status: result.status,
  errorCode: result.errorCode ?? null,
  imageCount: result.imageCount ?? 0,
  evidencePath: relative(stagingRoot, evidencePath).replace(/\\/g, '/'),
};
const output = `${JSON.stringify(summary, null, 2)}\n`;
if (result.status === 'passed') process.stdout.write(output);
else process.stderr.write(output);
process.exitCode = result.status === 'passed' ? 0 : result.status === 'blocked_external' ? 2 : 1;

function blockedResult(error) {
  const known = error instanceof RegistrySignatureError || error instanceof TargetProfileError;
  return Object.freeze({
    schemaVersion: REGISTRY_SIGNATURE_SCHEMA,
    status: known ? (error.status ?? 'blocked_external') : 'failed',
    errorCode: known ? error.code : 'SIGNATURE_CHECK_FAILED',
    imageCount: 0,
  });
}

function optionValue(arguments__, option) {
  const index = arguments__.indexOf(option);
  if (index === -1) return null;
  const value = arguments__[index + 1];
  if (!value || value.startsWith('--')) throw new RegistrySignatureError('SIGNATURE_ARGUMENT_INVALID');
  return value;
}
