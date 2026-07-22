import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { FileSecurityService } from '../src/files/file-security.service';
import { ExcelParserService } from '../src/import-tasks/excel-parser.service';
import { XlsConverterService } from '../src/import-tasks/xls-converter.service';

interface ManifestSample {
  sampleId: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  fileSecurity: { status: string };
}

interface LocalManifest {
  sourceRoot: string;
  samples: ManifestSample[];
}

interface SampleProfile {
  sampleId: string;
  sizeBytes: number;
  status: 'passed' | 'failed';
  errorCode?: string;
  durationMs: number;
  outputBytes?: number;
  sheetCount?: number;
  hiddenSheetCount?: number;
  cellCount?: number;
  formulaCellCount?: number;
  mergeCount?: number;
  formulaRoundTrip?: boolean;
  mergeRoundTrip?: boolean;
  visibilityRoundTrip?: boolean;
  parseStatus?: 'passed' | 'failed' | 'skipped';
  parseErrorCode?: string;
  selectedSheetIndex?: number;
  parsedRows?: number;
  pendingRows?: number;
  errorRows?: number;
  formulaWarningRows?: number;
  formulaErrorRows?: number;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  assertLocalOutput(options.output);
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8')) as LocalManifest;
  const sourceRoot = resolve(manifest.sourceRoot);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error('Manifest source root is not a directory');
  const samples = manifest.samples
    .filter((sample) => sample.extension === '.xls' && sample.fileSecurity.status === 'accepted')
    .sort((left, right) => left.sampleId.localeCompare(right.sampleId));

  const config = new ConfigService({
    fileScan: { mode: 'basic', clamavHost: '127.0.0.1', clamavPort: 3310, timeoutMs: 15_000 },
    xlsConverter: { timeoutMs: options.timeoutMs, maxOutputMb: options.maxOutputMb }
  });
  const security = new FileSecurityService(config);
  const converter = new XlsConverterService(config, security);
  const parser = new ExcelParserService();
  const profiles: SampleProfile[] = [];
  let peakRssBytes = process.memoryUsage().rss;

  for (const sample of samples) {
    const sourcePath = resolveSamplePath(sourceRoot, sample.relativePath);
    const source = await readFile(sourcePath);
    if (hash(source) !== sample.sha256) throw new Error(`Source hash mismatch for ${sample.sampleId}`);
    const startedAt = performance.now();
    try {
      const converted = await converter.convert(source);
      const inspection = await parser.inspect(converted.buffer);
      const inspectedFormulaCount = inspection.sheets.reduce((sum, sheet) => sum + sheet.formulaCellCount, 0);
      const inspectedMergeCount = inspection.sheets.reduce((sum, sheet) => sum + sheet.mergeCount, 0);
      const inspectedHiddenCount = inspection.sheets.filter((sheet) => sheet.state !== 'visible').length;
      const profile: SampleProfile = {
        sampleId: sample.sampleId,
        sizeBytes: sample.sizeBytes,
        status: 'passed',
        durationMs: 0,
        outputBytes: converted.buffer.length,
        sheetCount: converted.metadata.sheetCount,
        hiddenSheetCount: converted.metadata.hiddenSheetCount + converted.metadata.veryHiddenSheetCount,
        cellCount: converted.metadata.cellCount,
        formulaCellCount: converted.metadata.formulaCellCount,
        mergeCount: converted.metadata.mergeCount,
        formulaRoundTrip: converted.metadata.formulaCellCount === inspectedFormulaCount,
        mergeRoundTrip: converted.metadata.mergeCount === inspectedMergeCount,
        visibilityRoundTrip: converted.metadata.sheetCount === inspection.sheets.length &&
          converted.metadata.hiddenSheetCount + converted.metadata.veryHiddenSheetCount === inspectedHiddenCount
      };

      const selectedSheet = inspection.sheets.find((sheet) => sheet.nonEmpty && sheet.state === 'visible')
        ?? inspection.sheets.find((sheet) => sheet.nonEmpty);
      const header = selectedSheet?.headerCandidates[0];
      if (!selectedSheet || !header) {
        profile.parseStatus = 'skipped';
        profile.parseErrorCode = 'no_header_candidate';
      } else {
        profile.selectedSheetIndex = selectedSheet.sheetIndex;
        try {
          const parsed = await parser.parse(converted.buffer, {
            sheetIndex: selectedSheet.sheetIndex,
            headerStartRowIndex: header.startRowIndex,
            headerRowIndex: header.endRowIndex,
            allowHiddenSheet: selectedSheet.state !== 'visible',
            allowCachedFormulaResults: true
          });
          profile.parseStatus = 'passed';
          profile.parsedRows = parsed.rows.length;
          profile.pendingRows = parsed.rows.filter((row) => row.status === 'pending').length;
          profile.errorRows = parsed.rows.filter((row) => row.status === 'error').length;
          profile.formulaWarningRows = parsed.rows.filter((row) => (
            row.warnings.some((warning) => warning.includes('使用公式缓存结果'))
          )).length;
          profile.formulaErrorRows = parsed.rows.filter((row) => (
            row.errors.some((error) => error.includes('公式单元格'))
          )).length;
        } catch (error) {
          profile.parseStatus = 'failed';
          profile.parseErrorCode = safeErrorCode(error);
        }
      }
      profile.durationMs = roundedDuration(startedAt);
      profiles.push(profile);
    } catch (error) {
      profiles.push({
        sampleId: sample.sampleId,
        sizeBytes: sample.sizeBytes,
        status: 'failed',
        errorCode: safeErrorCode(error),
        durationMs: roundedDuration(startedAt)
      });
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    if (hash(await readFile(sourcePath)) !== sample.sha256) {
      throw new Error(`Source changed during profile for ${sample.sampleId}`);
    }
  }

  const passed = profiles.filter((profile) => profile.status === 'passed');
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    limits: { timeoutMs: options.timeoutMs, maxOutputMb: options.maxOutputMb },
    aggregate: {
      eligibleSamples: profiles.length,
      passed: passed.length,
      failed: profiles.length - passed.length,
      sourceFilesUnchanged: profiles.length === samples.length,
      totalInputBytes: profiles.reduce((sum, profile) => sum + profile.sizeBytes, 0),
      totalOutputBytes: passed.reduce((sum, profile) => sum + (profile.outputBytes ?? 0), 0),
      totalSheets: passed.reduce((sum, profile) => sum + (profile.sheetCount ?? 0), 0),
      hiddenSheets: passed.reduce((sum, profile) => sum + (profile.hiddenSheetCount ?? 0), 0),
      totalCells: passed.reduce((sum, profile) => sum + (profile.cellCount ?? 0), 0),
      formulaCells: passed.reduce((sum, profile) => sum + (profile.formulaCellCount ?? 0), 0),
      merges: passed.reduce((sum, profile) => sum + (profile.mergeCount ?? 0), 0),
      formulaRoundTripFailures: passed.filter((profile) => !profile.formulaRoundTrip).length,
      mergeRoundTripFailures: passed.filter((profile) => !profile.mergeRoundTrip).length,
      visibilityRoundTripFailures: passed.filter((profile) => !profile.visibilityRoundTrip).length,
      parsePassed: passed.filter((profile) => profile.parseStatus === 'passed').length,
      parseFailed: passed.filter((profile) => profile.parseStatus === 'failed').length,
      parseSkipped: passed.filter((profile) => profile.parseStatus === 'skipped').length,
      parsedRows: passed.reduce((sum, profile) => sum + (profile.parsedRows ?? 0), 0),
      pendingRows: passed.reduce((sum, profile) => sum + (profile.pendingRows ?? 0), 0),
      errorRows: passed.reduce((sum, profile) => sum + (profile.errorRows ?? 0), 0),
      formulaWarningRows: passed.reduce((sum, profile) => sum + (profile.formulaWarningRows ?? 0), 0),
      formulaErrorRows: passed.reduce((sum, profile) => sum + (profile.formulaErrorRows ?? 0), 0),
      maxDurationMs: Math.max(0, ...profiles.map((profile) => profile.durationMs)),
      peakProcessRssBytes: peakRssBytes
    },
    samples: profiles
  };

  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write([
    `XLS profile completed: ${profiles.length} anonymous samples`,
    `Passed: ${result.aggregate.passed}; failed: ${result.aggregate.failed}`,
    `Formula/merge/visibility round-trip failures: ${result.aggregate.formulaRoundTripFailures}/${result.aggregate.mergeRoundTripFailures}/${result.aggregate.visibilityRoundTripFailures}`,
    `Parse passed/failed/skipped: ${result.aggregate.parsePassed}/${result.aggregate.parseFailed}/${result.aggregate.parseSkipped}`,
    `Original files unchanged: ${result.aggregate.sourceFilesUnchanged ? 'yes' : 'no'}`,
    `Local result: ${options.output}`
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
  const timeoutMs = readInteger(values.get('--timeout-ms'), 30_000, 1_000, 300_000, '--timeout-ms');
  const maxOutputMb = readInteger(values.get('--max-output-mb'), 50, 1, 100, '--max-output-mb');
  return {
    manifest: resolve(repositoryRoot, values.get('--manifest') ?? '.realdata-test/inventory.local.json'),
    output: resolve(repositoryRoot, values.get('--output') ?? '.realdata-test/xls-profile.local.json'),
    timeoutMs,
    maxOutputMb
  };
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
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

function assertLocalOutput(output: string) {
  const localRoot = resolve(process.cwd(), '..', '.realdata-test');
  const relation = relative(localRoot, resolve(output));
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error('XLS profile output must stay inside .realdata-test');
  }
}

function hash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function roundedDuration(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('公式')) return 'formula_rejected';
  if (message.includes('外部')) return 'external_reference_rejected';
  if (message.includes('宏') || message.includes('嵌入')) return 'active_content_rejected';
  if (message.includes('行') || message.includes('列') || message.includes('范围')) return 'dimension_limit';
  if (message.includes('超时')) return 'timeout';
  if (message.includes('损坏') || message.includes('OLE') || message.includes('格式')) return 'invalid_xls';
  return 'conversion_rejected';
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown XLS profile failure';
  process.stderr.write(`XLS profile failed: ${message}\n`);
  process.exitCode = 1;
});
