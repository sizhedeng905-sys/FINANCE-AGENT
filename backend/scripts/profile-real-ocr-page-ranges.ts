import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { DocumentPreprocessorService } from '../src/ocr/document-preprocessor.service';

interface ManifestSample {
  sampleId: string;
  relativePath: string;
  extension: string;
  sha256: string;
  pdf?: { pages: number; encrypted: boolean; activeContent: boolean };
  fileSecurity: { status: string };
}

interface LocalManifest {
  sourceRoot: string;
  samples: ManifestSample[];
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8')) as LocalManifest;
  const sourceRoot = resolve(manifest.sourceRoot);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error('Manifest source root is not a directory');
  const candidates = manifest.samples
    .filter((sample) => sample.extension === '.pdf'
      && sample.fileSecurity.status === 'accepted'
      && !sample.pdf?.encrypted
      && (sample.pdf?.pages ?? 0) > options.maxPages)
    .sort((left, right) => (right.pdf?.pages ?? 0) - (left.pdf?.pages ?? 0)
      || left.sampleId.localeCompare(right.sampleId));
  const sample = options.sampleId
    ? candidates.find((item) => item.sampleId === options.sampleId)
    : candidates[0];
  if (!sample) throw new Error('No accepted over-limit PDF matched the requested sample');

  const sourcePath = resolveSamplePath(sourceRoot, sample.relativePath);
  const source = await readFile(sourcePath);
  const beforeHash = hash(source);
  if (beforeHash !== sample.sha256) throw new Error(`Source hash mismatch for ${sample.sampleId}`);
  const pageCount = sample.pdf?.pages ?? 0;
  const preprocessor = new DocumentPreprocessorService({
    get: <T>(key: string) => key === 'ocr.maxPdfPages' ? options.maxPages as T : undefined
  } as ConfigService);
  const segments: Array<{ pageStart: number; pageEnd: number; outputPages: number }> = [];

  for (let pageStart = 1; pageStart <= pageCount; pageStart += options.maxPages) {
    const pageEnd = Math.min(pageCount, pageStart + options.maxPages - 1);
    const prepared = await preprocessor.prepare(source, 'application/pdf', { pageStart, pageEnd });
    const outputPages = (await PDFDocument.load(prepared.buffer)).getPageCount();
    const expectedPages = pageEnd - pageStart + 1;
    if (outputPages !== expectedPages || prepared.pages.length !== expectedPages) {
      throw new Error(`Prepared page count mismatch for ${sample.sampleId}`);
    }
    if (prepared.pages[0]?.page !== pageStart || prepared.pages.at(-1)?.page !== pageEnd) {
      throw new Error(`Original page mapping mismatch for ${sample.sampleId}`);
    }
    segments.push({ pageStart, pageEnd, outputPages });
  }

  const afterHash = hash(await readFile(sourcePath));
  if (afterHash !== beforeHash) throw new Error(`Source changed during page-range profile: ${sample.sampleId}`);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    sampleId: sample.sampleId,
    originalPageCount: pageCount,
    maxPagesPerTask: options.maxPages,
    segments,
    allPagesCovered: segments.reduce((sum, segment) => sum + segment.outputPages, 0) === pageCount,
    sourceUnchanged: true,
    persistedDerivedFiles: 0
  }, null, 2)}\n`);
}

function parseOptions(args: string[]) {
  const repositoryRoot = resolve(process.cwd(), '..');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid CLI argument near ${key}`);
    values.set(key, value);
  }
  const maxPages = Number(values.get('--max-pages') ?? '20');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) {
    throw new Error('--max-pages must be an integer between 1 and 500');
  }
  return {
    manifest: resolve(repositoryRoot, values.get('--manifest') ?? '.realdata-test/inventory.local.json'),
    sampleId: values.get('--sample-id'),
    maxPages
  };
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

function hash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

void main().catch((error: unknown) => {
  process.stderr.write(`OCR page-range profile failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
