import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AlertWebhookError,
  ALERT_SYNTHETIC_SCHEMA,
  deliverSyntheticAlertPair,
  requireSyntheticDeliveryApproval,
} from './alert-webhook.mjs';
import { loadTargetContext } from './target-context.mjs';
import { TargetProfileError } from './target-profile.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const evidenceRoot = join(stagingRoot, '.evidence');
const environmentPath = optionValue(arguments_, '--env-file') ?? '.env';
let result;

try {
  requireSyntheticDeliveryApproval(arguments_, process.env);
  const context = await loadTargetContext({ stagingRoot, environmentPath });
  result = await deliverSyntheticAlertPair({
    urlFile: join(stagingRoot, '.secrets', 'alert_webhook_url'),
    routeId: context.environment.STAGING_TARGET_ALERT_ROUTE_ID,
  });
} catch (error) {
  result = blockedResult(error);
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const evidenceId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const evidencePath = join(evidenceRoot, `alert-synthetic-${evidenceId}.json`);
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

const summary = {
  schemaVersion: result.schemaVersion,
  status: result.status,
  errorCode: result.errorCode ?? null,
  deliveries: result.deliveries ?? [],
  evidencePath: relative(stagingRoot, evidencePath).replace(/\\/g, '/'),
};
const output = `${JSON.stringify(summary, null, 2)}\n`;
if (result.status === 'passed') process.stdout.write(output);
else process.stderr.write(output);
process.exitCode = result.status === 'passed' ? 0 : result.status === 'blocked_external' ? 2 : 1;

function blockedResult(error) {
  const known = error instanceof AlertWebhookError || error instanceof TargetProfileError;
  return Object.freeze({
    schemaVersion: ALERT_SYNTHETIC_SCHEMA,
    status: known ? (error.status ?? 'blocked_external') : 'failed',
    errorCode: known ? error.code : 'ALERT_SYNTHETIC_EXECUTION_FAILED',
    failedPhase: error instanceof AlertWebhookError ? (error.evidence.failedPhase ?? null) : null,
    deliveries: error instanceof AlertWebhookError ? (error.evidence.deliveries ?? []) : [],
  });
}

function optionValue(arguments__, option) {
  const index = arguments__.indexOf(option);
  if (index === -1) return null;
  const value = arguments__[index + 1];
  if (!value || value.startsWith('--')) throw new AlertWebhookError('ALERT_SYNTHETIC_ARGUMENT_INVALID');
  return value;
}
