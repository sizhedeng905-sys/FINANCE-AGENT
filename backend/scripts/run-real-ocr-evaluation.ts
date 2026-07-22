import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { PrismaClient, RecordSourceType } from '@prisma/client';

import { OCR_EVALUATION_FIELDS } from '../src/real-data-test/ocr-field-catalog';
import {
  evaluateOcrPredictions,
  OcrEvaluationPrediction,
  OcrEvaluationSplit,
  OcrGroundTruthLabel,
  validateOcrGroundTruthLabel
} from '../src/real-data-test/ocr-evaluation';

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
};
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

interface ManifestSample {
  sampleId: string;
  relativePath: string;
  extension: string;
  sha256: string;
}

interface LocalManifest {
  sourceRoot: string;
  samples: ManifestSample[];
}

interface PlannedSample {
  sampleId: string;
  split: OcrEvaluationSplit;
  format: string;
  pageCount: number;
  ocrPreprocessor: string;
}

interface LocalPlan {
  samples: PlannedSample[];
}

interface RawRunResult {
  sampleId: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  sourceUnchanged: boolean;
  response?: Record<string, unknown>;
  errorCode?: string;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  assertLocalPath(options.output, 'OCR raw evaluation output');
  assertLocalPath(options.summary, 'OCR evaluation summary');
  assertLoopbackUrl(options.baseUrl);
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8')) as LocalManifest;
  const plan = JSON.parse(await readFile(options.plan, 'utf8')) as LocalPlan;
  await assertBlindLabelsFrozen(options.split, options.labels, options.labelsFreeze);
  const labels = await readLabels(options.labels);
  const recordsBefore = await countOcrRecords();
  const sourceRoot = resolve(manifest.sourceRoot);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error('Manifest source root is not a directory');
  const manifestById = new Map(manifest.samples.map((sample) => [sample.sampleId, sample]));
  const labelById = new Map(labels.map((label) => [label.sampleId, label]));
  const apiKey = await readApiKey(options.apiKeyEnvFile, options.apiKeyEnvironmentName);
  await assertProviderReady(options.baseUrl, options.timeoutMs);
  const priorResults = options.restart
    ? new Map<string, RawRunResult>()
    : await readPriorResults(options.output, options.baseUrl, options.split);

  const planned = plan.samples
    .filter((sample) => options.split === 'all' || sample.split === options.split)
    .slice(0, options.maxSamples);
  const results: RawRunResult[] = [];
  const predictions: OcrEvaluationPrediction[] = [];
  let peakRssBytes = process.memoryUsage().rss;
  let reused = 0;

  for (const plannedSample of planned) {
    const sample = manifestById.get(plannedSample.sampleId);
    if (!sample) throw new Error(`OCR plan references an unknown sample: ${plannedSample.sampleId}`);
    if (!labelById.has(plannedSample.sampleId)) throw new Error(`OCR label skeleton is missing: ${plannedSample.sampleId}`);
    if (plannedSample.ocrPreprocessor !== 'accepted' && !options.includeOverPageLimit) {
      results.push({
        sampleId: sample.sampleId,
        status: 'skipped',
        durationMs: 0,
        sourceUnchanged: true,
        errorCode: 'backend_page_limit'
      });
      continue;
    }

    const sourcePath = resolveSamplePath(sourceRoot, sample.relativePath);
    const source = await readFile(sourcePath);
    const sourceHash = hash(source);
    if (sourceHash !== sample.sha256) throw new Error(`Source hash mismatch for ${sample.sampleId}`);
    const prior = priorResults.get(sample.sampleId);
    if (prior?.status === 'passed' && prior.response) {
      try {
        predictions.push(toPrediction(sample.sampleId, prior.response));
        results.push({
          ...prior,
          sourceUnchanged: hash(await readFile(sourcePath)) === sourceHash
        });
        reused += 1;
        continue;
      } catch {
        // A malformed or stale local result is recomputed below.
      }
    }
    const startedAt = performance.now();
    try {
      const response = await recognize(options.baseUrl, apiKey, sample, source, options.timeoutMs);
      const prediction = toPrediction(sample.sampleId, response);
      predictions.push(prediction);
      results.push({
        sampleId: sample.sampleId,
        status: 'passed',
        durationMs: roundedDuration(startedAt),
        sourceUnchanged: hash(await readFile(sourcePath)) === sourceHash,
        response
      });
    } catch (error) {
      results.push({
        sampleId: sample.sampleId,
        status: 'failed',
        durationMs: roundedDuration(startedAt),
        sourceUnchanged: hash(await readFile(sourcePath)) === sourceHash,
        errorCode: safeErrorCode(error)
      });
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  const evaluatedIds = new Set(planned.map((sample) => sample.sampleId));
  const evaluatedLabels = labels.filter((label) => evaluatedIds.has(label.sampleId));
  const recordsAfter = await countOcrRecords();
  const evaluation = evaluateOcrPredictions(evaluatedLabels, predictions, {
    lowConfidenceThreshold: options.lowConfidenceThreshold,
    unconfirmedAutoRecordCount: Math.max(0, recordsAfter - recordsBefore)
  });
  const runArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider: { baseUrl: options.baseUrl, localOnly: true },
    split: options.split,
    results
  };
  const summaryArtifact = {
    schemaVersion: 1,
    generatedAt: runArtifact.generatedAt,
    provider: { baseUrl: options.baseUrl, localOnly: true },
    split: options.split,
    aggregate: {
      planned: planned.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      reused,
      sourceFilesUnchanged: results.every((result) => result.sourceUnchanged),
      totalDurationMs: rounded(results.reduce((sum, result) => sum + result.durationMs, 0)),
      maxDurationMs: Math.max(0, ...results.map((result) => result.durationMs)),
      peakProcessRssBytes: peakRssBytes
    },
    evaluation
  };
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(runArtifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(options.summary, `${JSON.stringify(summaryArtifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  process.stdout.write([
    `OCR provider evaluation completed: ${summaryArtifact.aggregate.passed}/${planned.length} passed`,
    `Failed/skipped/reused: ${summaryArtifact.aggregate.failed}/${summaryArtifact.aggregate.skipped}/${summaryArtifact.aggregate.reused}`,
    `Evaluation gate: ${evaluation.gate}; reviewed labels: ${evaluation.samples.reviewed}`,
    `Original files unchanged: ${summaryArtifact.aggregate.sourceFilesUnchanged ? 'yes' : 'no'}`,
    `Local raw result: ${options.output}`,
    `Local aggregate summary: ${options.summary}`
  ].join('\n') + '\n');
}

function parseOptions(args: string[]) {
  const repositoryRoot = resolve(process.cwd(), '..');
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--include-over-page-limit') {
      flags.add(key);
      continue;
    }
    if (key === '--restart') {
      flags.add(key);
      continue;
    }
    const value = args[index + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid CLI argument near ${key}`);
    values.set(key, value);
    index += 1;
  }
  const split = values.get('--split') ?? 'calibration';
  if (!['calibration', 'validation', 'blind', 'all'].includes(split)) throw new Error('--split is invalid');
  const outputSuffix = split === 'all' ? 'all' : split;
  return {
    manifest: resolve(repositoryRoot, values.get('--manifest') ?? '.realdata-test/inventory.local.json'),
    plan: resolve(repositoryRoot, values.get('--plan') ?? '.realdata-test/ocr-sample-plan.local.json'),
    labels: resolve(repositoryRoot, values.get('--labels') ?? '.realdata-test/labels.local.jsonl'),
    labelsFreeze: resolve(repositoryRoot, values.get('--labels-freeze') ?? '.realdata-test/labels.freeze.local.json'),
    output: resolve(repositoryRoot, values.get('--output') ?? `.realdata-test/reports/ocr-provider-output.${outputSuffix}.local.json`),
    summary: resolve(repositoryRoot, values.get('--summary') ?? `.realdata-test/reports/ocr-evaluation-summary.${outputSuffix}.local.json`),
    apiKeyEnvFile: resolve(repositoryRoot, values.get('--api-key-env-file') ?? 'deploy/model-services/.env'),
    apiKeyEnvironmentName: values.get('--api-key-name') ?? 'LOCAL_MODEL_API_KEY',
    baseUrl: (values.get('--base-url') ?? 'http://127.0.0.1:8868').replace(/\/+$/, ''),
    split: split as OcrEvaluationSplit | 'all',
    maxSamples: integerOption(values.get('--max-samples'), 100, 1, 1000, '--max-samples'),
    timeoutMs: integerOption(values.get('--timeout-ms'), 300_000, 1_000, 1_800_000, '--timeout-ms'),
    lowConfidenceThreshold: numberOption(values.get('--low-confidence-threshold'), 0.8, 0, 1, '--low-confidence-threshold'),
    includeOverPageLimit: flags.has('--include-over-page-limit'),
    restart: flags.has('--restart')
  };
}

async function assertBlindLabelsFrozen(
  split: OcrEvaluationSplit | 'all',
  labelsPath: string,
  freezePath: string
) {
  if (split !== 'blind' && split !== 'all') return;
  let freeze: unknown;
  try {
    freeze = JSON.parse(await readFile(freezePath, 'utf8'));
  } catch {
    throw new Error('Blind OCR evaluation requires a reviewed labels freeze marker');
  }
  const labelsSha256 = hash(await readFile(labelsPath));
  if (!isRecord(freeze) || freeze.schemaVersion !== 1 || freeze.labelsSha256 !== labelsSha256) {
    throw new Error('Blind OCR labels changed after the freeze marker was created');
  }
}

async function countOcrRecords() {
  const prisma = new PrismaClient();
  try {
    return await prisma.businessRecord.count({ where: { sourceType: RecordSourceType.ocr } });
  } finally {
    await prisma.$disconnect();
  }
}

async function readPriorResults(path: string, baseUrl: string, split: OcrEvaluationSplit | 'all') {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map<string, RawRunResult>();
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return new Map<string, RawRunResult>();
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || value.split !== split) return new Map<string, RawRunResult>();
  if (!isRecord(value.provider) || value.provider.baseUrl !== baseUrl || !Array.isArray(value.results)) {
    return new Map<string, RawRunResult>();
  }
  const results = new Map<string, RawRunResult>();
  for (const item of value.results) {
    if (!isRecord(item) || typeof item.sampleId !== 'string' || item.status !== 'passed' || !isRecord(item.response)) {
      continue;
    }
    results.set(item.sampleId, {
      sampleId: item.sampleId,
      status: 'passed',
      durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
      sourceUnchanged: item.sourceUnchanged === true,
      response: item.response
    });
  }
  return results;
}

async function recognize(
  baseUrl: string,
  apiKey: string,
  sample: ManifestSample,
  source: Buffer,
  timeoutMs: number
) {
  const mimeType = MIME_TYPES[sample.extension];
  if (!mimeType) throw new Error('unsupported_format');
  const body = new FormData();
  body.set('file', new Blob([Uint8Array.from(source)], { type: mimeType }), `${sample.sampleId}${sample.extension}`);
  body.set('documentId', sample.sampleId);
  body.set('templateFields', JSON.stringify(OCR_EVALUATION_FIELDS));
  const response = await fetch(`${baseUrl}/ocr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await readLimitedJson(response);
  if (!response.ok) throw new ProviderHttpError(response.status);
  if (!isRecord(payload)) throw new Error('invalid_provider_schema');
  return payload;
}

function toPrediction(sampleId: string, response: Record<string, unknown>): OcrEvaluationPrediction {
  if (response.documentId !== sampleId) throw new Error('document_id_mismatch');
  if (typeof response.extractedText !== 'string' || response.extractedText.length > 100_000) {
    throw new Error('invalid_provider_schema');
  }
  if (!Array.isArray(response.fieldCandidates) || response.fieldCandidates.length > 500) {
    throw new Error('invalid_provider_schema');
  }
  const fieldCandidates = response.fieldCandidates.map((value) => {
    if (!isRecord(value) || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
      throw new Error('invalid_provider_schema');
    }
    return {
      targetFieldKey: typeof value.targetFieldKey === 'string' ? value.targetFieldKey : undefined,
      normalizedValue: value.normalizedValue,
      confidence: value.confidence,
      page: typeof value.page === 'number' ? value.page : undefined
    };
  });
  const rawResult = isRecord(response.rawResult) ? response.rawResult : {};
  return {
    sampleId,
    documentType: typeof rawResult.documentType === 'string' ? rawResult.documentType : null,
    fieldCandidates
  };
}

async function assertProviderReady(baseUrl: string, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)) });
  } catch {
    throw new Error('Local OCR provider health check failed');
  }
  if (!response.ok) throw new Error(`Local OCR provider health check returned HTTP ${response.status}`);
  const payload = await readLimitedJson(response);
  if (!isRecord(payload) || payload.status !== 'ok') throw new Error('Local OCR provider health payload is invalid');
}

async function readLimitedJson(response: Response) {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('provider_response_too_large');
  if (!response.body) throw new Error('empty_provider_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('provider_response_too_large');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('invalid_provider_json');
  }
}

async function readApiKey(path: string, name: string) {
  const source = await readFile(path, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 1 || line.trimStart().startsWith('#')) continue;
    if (line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
    if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
    return value;
  }
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name} is missing`);
  return value;
}

async function readLabels(path: string) {
  const source = await readFile(path, 'utf8');
  const labels: OcrGroundTruthLabel[] = [];
  const ids = new Set<string>();
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`OCR labels line ${index + 1} is not valid JSON`);
    }
    validateOcrGroundTruthLabel(value);
    if (ids.has(value.sampleId)) throw new Error(`Duplicate OCR label sampleId: ${value.sampleId}`);
    ids.add(value.sampleId);
    labels.push(value);
  }
  return labels;
}

function assertLoopbackUrl(value: string) {
  const url = new URL(value);
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !hosts.has(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('OCR evaluation provider must be an HTTP loopback URL');
  }
}

function resolveSamplePath(sourceRoot: string, relativePath: string) {
  if (isAbsolute(relativePath)) throw new Error('Manifest sample path must be relative');
  const absolutePath = resolve(sourceRoot, relativePath);
  const relation = relative(sourceRoot, absolutePath);
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error('Manifest sample path escaped source root');
  }
  return absolutePath;
}

function assertLocalPath(path: string, label: string) {
  const localRoot = resolve(process.cwd(), '..', '.realdata-test');
  const relation = relative(localRoot, resolve(path));
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} must stay inside .realdata-test`);
  }
}

function safeErrorCode(error: unknown) {
  if (error instanceof ProviderHttpError) return `provider_http_${error.status}`;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('timeout') || error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (message.includes('response_too_large')) return 'response_too_large';
  if (message.includes('provider_schema') || message.includes('provider_json') || message.includes('document_id')) {
    return 'invalid_provider_response';
  }
  return 'provider_failure';
}

function integerOption(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is invalid`);
  return parsed;
}

function numberOption(value: string | undefined, fallback: number, minExclusive: number, max: number, name: string) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= minExclusive || parsed > max) throw new Error(`${name} is invalid`);
  return parsed;
}

function hash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function roundedDuration(startedAt: number) {
  return rounded(performance.now() - startedAt);
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`provider_http_${status}`);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown OCR evaluation failure';
  process.stderr.write(`OCR provider evaluation failed: ${message}\n`);
  process.exitCode = 1;
});
