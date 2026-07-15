import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  createOcrLabelSkeleton,
  OcrGroundTruthLabel,
  OcrEvaluationSplit,
  validateOcrGroundTruthLabel
} from '../src/real-data-test/ocr-evaluation';

const OCR_EXTENSIONS = new Set(['.pdf', '.jpg', '.png']);

interface ManifestSample {
  sampleId: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  family: string;
  route: string;
  reasons: string[];
  image?: { width: number; height: number; longImage: boolean };
  pdf?: { pages: number; encrypted: boolean; activeContent: boolean };
  fileSecurity: { status: string };
  ocrPreprocessor: { status: string };
}

interface LocalManifest {
  sourceRoot: string;
  samples: ManifestSample[];
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  assertLocalPath(options.labels, 'OCR labels');
  assertLocalPath(options.output, 'OCR sample plan');
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8')) as LocalManifest;
  const sourceRoot = resolve(manifest.sourceRoot);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error('Manifest source root is not a directory');

  const eligible = manifest.samples
    .filter((sample) => OCR_EXTENSIONS.has(sample.extension) && sample.fileSecurity.status === 'accepted')
    .sort((left, right) => left.sampleId.localeCompare(right.sampleId));
  const byHash = new Map<string, ManifestSample[]>();
  for (const sample of eligible) {
    const group = byHash.get(sample.sha256) ?? [];
    group.push(sample);
    byHash.set(sample.sha256, group);
  }
  const uniqueSamples = [...byHash.values()].map((group) => group[0]);
  const selectedIds = new Set<string>();

  for (const sample of uniqueSamples) {
    if ((sample.pdf?.pages ?? 1) > 1 || sample.image?.longImage) selectedIds.add(sample.sampleId);
  }
  for (const family of [...new Set(uniqueSamples.map((sample) => sample.family))].sort()) {
    const candidates = uniqueSamples
      .filter((sample) => sample.family === family)
      .sort(compareCoveragePriority);
    for (const sample of candidates.slice(0, Math.min(options.perFamily, candidates.length))) {
      selectedIds.add(sample.sampleId);
    }
  }

  const selected = uniqueSamples.filter((sample) => selectedIds.has(sample.sampleId)).sort((left, right) => (
    left.sampleId.localeCompare(right.sampleId)
  ));
  const existingLabels = await readLabels(options.labels);
  const existingById = new Map(existingLabels.map((label) => [label.sampleId, label]));
  const additions = selected
    .filter((sample) => !existingById.has(sample.sampleId))
    .map((sample) => createOcrLabelSkeleton(sample.sampleId, sample.family, splitFor(sample.sha256)));

  let unchanged = 0;
  for (const sample of selected) {
    const sourcePath = resolveSamplePath(sourceRoot, sample.relativePath);
    const before = hash(await readFile(sourcePath));
    if (before !== sample.sha256) throw new Error(`Source hash mismatch for ${sample.sampleId}`);
    if (hash(await readFile(sourcePath)) === before) unchanged += 1;
  }

  await mkdir(dirname(options.labels), { recursive: true, mode: 0o700 });
  if (additions.length > 0) {
    const serialized = additions.map((label) => JSON.stringify(label)).join('\n') + '\n';
    if (existingLabels.length === 0) await writeFile(options.labels, serialized, { encoding: 'utf8', mode: 0o600 });
    else await appendFile(options.labels, serialized, { encoding: 'utf8', mode: 0o600 });
  }
  await chmod(options.labels, 0o600).catch(() => undefined);

  const duplicateGroups = [...byHash.values()].filter((group) => group.length > 1);
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: {
      perFamily: options.perFamily,
      accuracyUsesOnePhysicalFilePerSha256: true,
      duplicateCopiesExcludedFromAccuracy: true,
      longImagesAndMultiPagePdfsAlwaysIncluded: true
    },
    aggregate: {
      eligiblePhysicalFiles: eligible.length,
      eligibleUniqueFiles: uniqueSamples.length,
      selectedUniqueFiles: selected.length,
      selectedFilesUnchanged: unchanged,
      duplicateGroups: duplicateGroups.length,
      duplicatePhysicalFiles: duplicateGroups.reduce((sum, group) => sum + group.length, 0),
      labelsAlreadyPresent: selected.filter((sample) => existingById.has(sample.sampleId)).length,
      labelSkeletonsAdded: additions.length,
      reviewedLabels: [...existingLabels, ...additions].filter((label) => label.reviewStatus === 'reviewed').length,
      byFamily: countBy(selected, (sample) => sample.family),
      byFormat: countBy(selected, (sample) => sample.extension),
      bySplit: countBy(selected, (sample) => splitFor(sample.sha256))
    },
    samples: selected.map((sample) => ({
      sampleId: sample.sampleId,
      family: sample.family,
      format: sample.extension.slice(1),
      split: splitFor(sample.sha256),
      route: sample.route,
      ocrPreprocessor: sample.ocrPreprocessor.status,
      pageCount: sample.pdf?.pages ?? 1,
      width: sample.image?.width,
      height: sample.image?.height,
      longImage: sample.image?.longImage ?? false,
      reasons: sample.reasons
    })),
    robustnessDuplicates: duplicateGroups.map((group, index) => ({
      groupId: `OCR-DUP-${String(index + 1).padStart(3, '0')}`,
      sampleIds: group.map((sample) => sample.sampleId).sort()
    }))
  };
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  process.stdout.write([
    `OCR evaluation plan prepared: ${selected.length}/${eligible.length} anonymous physical files`,
    `Coverage by family: ${formatCounts(plan.aggregate.byFamily)}`,
    `Coverage by format: ${formatCounts(plan.aggregate.byFormat)}`,
    `Label skeletons added: ${additions.length}; reviewed labels: ${plan.aggregate.reviewedLabels}`,
    `Original selected files unchanged: ${unchanged === selected.length ? 'yes' : 'no'}`,
    `Local labels: ${options.labels}`,
    `Local sample plan: ${options.output}`
  ].join('\n') + '\n');
}

function parseOptions(args: string[]) {
  const repositoryRoot = resolve(process.cwd(), '..');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid CLI argument near ${key}`);
    values.set(key, value);
    index += 1;
  }
  const perFamily = Number(values.get('--per-family') ?? '5');
  if (!Number.isInteger(perFamily) || perFamily < 1 || perFamily > 100) {
    throw new Error('--per-family must be an integer between 1 and 100');
  }
  return {
    manifest: resolve(repositoryRoot, values.get('--manifest') ?? '.realdata-test/inventory.local.json'),
    labels: resolve(repositoryRoot, values.get('--labels') ?? '.realdata-test/labels.local.jsonl'),
    output: resolve(repositoryRoot, values.get('--output') ?? '.realdata-test/ocr-sample-plan.local.json'),
    perFamily
  };
}

async function readLabels(path: string) {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const labels: OcrGroundTruthLabel[] = [];
  const sampleIds = new Set<string>();
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`OCR labels line ${index + 1} is not valid JSON`);
    }
    validateOcrGroundTruthLabel(value);
    if (sampleIds.has(value.sampleId)) throw new Error(`Duplicate OCR label sampleId: ${value.sampleId}`);
    sampleIds.add(value.sampleId);
    labels.push(value);
  }
  return labels;
}

function compareCoveragePriority(left: ManifestSample, right: ManifestSample) {
  const leftEdge = Number(left.image?.longImage ?? false) + Number((left.pdf?.pages ?? 1) > 1);
  const rightEdge = Number(right.image?.longImage ?? false) + Number((right.pdf?.pages ?? 1) > 1);
  return rightEdge - leftEdge || right.sizeBytes - left.sizeBytes || left.sampleId.localeCompare(right.sampleId);
}

function splitFor(sha256: string): OcrEvaluationSplit {
  const bucket = Number.parseInt(sha256.slice(0, 8), 16) % 10;
  if (bucket < 6) return 'calibration';
  if (bucket < 8) return 'validation';
  return 'blind';
}

function countBy<T>(items: readonly T[], key: (item: T) => string) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)));
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ');
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

function hash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown OCR preparation failure';
  process.stderr.write(`OCR evaluation preparation failed: ${message}\n`);
  process.exitCode = 1;
});
