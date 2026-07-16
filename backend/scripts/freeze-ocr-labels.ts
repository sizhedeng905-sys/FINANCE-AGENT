import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { validateOcrGroundTruthLabel } from '../src/real-data-test/ocr-evaluation';

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const labelsSource = await readFile(options.labels, 'utf8');
  const labels = labelsSource.split(/\r?\n/).filter(Boolean).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`OCR labels line ${index + 1} is not valid JSON`);
    }
    validateOcrGroundTruthLabel(value);
    return value;
  });
  const blind = labels.filter((label) => label.split === 'blind');
  if (blind.length === 0) throw new Error('No blind OCR labels are available to freeze');
  const unreviewed = blind.filter((label) => label.reviewStatus !== 'reviewed');
  if (unreviewed.length > 0) {
    throw new Error(`${unreviewed.length} blind OCR label(s) still require independent human review`);
  }
  const marker = {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    confirmedBy: options.confirmedBy,
    labelsSha256: sha256(labelsSource),
    blindSampleCount: blind.length,
    blindSampleIdsSha256: sha256(blind.map((label) => label.sampleId).sort().join('\n'))
  };
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(options.output, 0o600).catch(() => undefined);
  process.stdout.write(`Frozen ${blind.length} reviewed blind OCR label(s): ${options.output}\n`);
}

function parseOptions(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid argument near ${key}`);
    values.set(key, value);
  }
  const confirmedBy = values.get('--confirmed-by')?.trim();
  if (!confirmedBy || confirmedBy.length > 100) throw new Error('--confirmed-by is required (maximum 100 characters)');
  const repositoryRoot = resolve(process.cwd(), '..');
  return {
    confirmedBy,
    labels: resolve(repositoryRoot, values.get('--labels') ?? '.realdata-test/labels.local.jsonl'),
    output: resolve(repositoryRoot, values.get('--output') ?? '.realdata-test/labels.freeze.local.json')
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  process.stderr.write(`OCR label freeze failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
