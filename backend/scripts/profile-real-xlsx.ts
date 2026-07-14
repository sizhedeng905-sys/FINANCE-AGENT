import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { ExcelParserService } from '../src/import-tasks/excel-parser.service';

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

interface CliOptions {
  manifest: string;
  output: string;
  minSizeMb: number;
  maxSizeMb: number;
  mode: 'inspect' | 'parse';
  formulaResults: 'reject' | 'cached';
  sampleId?: string;
}

interface SampleProfile {
  sampleId: string;
  sizeBytes: number;
  status: 'passed' | 'failed';
  errorCategory?: string;
  durationMs: number;
  rssDeltaBytes: number;
  sheetCount?: number;
  nonEmptySheetCount?: number;
  hiddenSheetCount?: number;
  requiresSheetSelection?: boolean;
  sheetsWithoutHeaderCandidates?: number;
  maxRows?: number;
  maxColumns?: number;
  mergeCount?: number;
  formulaCellCount?: number;
  parseStatus?: 'passed' | 'failed' | 'skipped';
  parseErrorCategory?: string;
  parseErrorCode?: string;
  selectedSheetIndex?: number;
  headerStartRowIndex?: number;
  headerRowIndex?: number;
  parsedColumns?: number;
  parsedRows?: number;
  pendingRows?: number;
  errorRows?: number;
  formulaErrorRows?: number;
  formulaWarningRows?: number;
  mergedDataErrorRows?: number;
  mergedDataWarningRows?: number;
  cellErrorRows?: number;
  otherErrorRows?: number;
  duplicateRows?: number;
  ignoredRows?: number;
  parseDurationMs?: number;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8')) as LocalManifest;
  const sourceRoot = resolve(manifest.sourceRoot);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error('Manifest source root is not a directory');
  assertLocalOutput(options.output);

  const minBytes = options.minSizeMb * 1024 * 1024;
  const maxBytes = options.maxSizeMb * 1024 * 1024;
  const samples = manifest.samples
    .filter((sample) => sample.extension === '.xlsx')
    .filter((sample) => sample.fileSecurity.status === 'accepted')
    .filter((sample) => sample.sizeBytes > minBytes && sample.sizeBytes <= maxBytes)
    .filter((sample) => !options.sampleId || sample.sampleId === options.sampleId)
    .sort((left, right) => left.sizeBytes - right.sizeBytes || left.sampleId.localeCompare(right.sampleId));
  if (options.sampleId && samples.length === 0) throw new Error('Requested sample is not eligible for this profile');

  const parser = new ExcelParserService();
  const profiles: SampleProfile[] = [];
  let peakRssBytes = process.memoryUsage().rss;

  for (const sample of samples) {
    const absolutePath = resolveSamplePath(sourceRoot, sample.relativePath);
    const buffer = await readFile(absolutePath);
    if (hash(buffer) !== sample.sha256) throw new Error(`Source hash mismatch for ${sample.sampleId}`);
    const rssBefore = process.memoryUsage().rss;
    const startedAt = performance.now();
    try {
      const inspection = await parser.inspect(buffer);
      const profile: SampleProfile = {
        sampleId: sample.sampleId,
        sizeBytes: sample.sizeBytes,
        status: 'passed',
        durationMs: roundedDuration(startedAt),
        rssDeltaBytes: 0,
        sheetCount: inspection.sheets.length,
        nonEmptySheetCount: inspection.sheets.filter((sheet) => sheet.nonEmpty).length,
        hiddenSheetCount: inspection.sheets.filter((sheet) => sheet.state !== 'visible').length,
        requiresSheetSelection: inspection.requiresSheetSelection,
        sheetsWithoutHeaderCandidates: inspection.sheets.filter((sheet) => sheet.nonEmpty && sheet.headerCandidates.length === 0).length,
        maxRows: Math.max(0, ...inspection.sheets.map((sheet) => sheet.rowCount)),
        maxColumns: Math.max(0, ...inspection.sheets.map((sheet) => sheet.columnCount)),
        mergeCount: inspection.sheets.reduce((sum, sheet) => sum + sheet.mergeCount, 0),
        formulaCellCount: inspection.sheets.reduce((sum, sheet) => sum + sheet.formulaCellCount, 0)
      };
      if (options.mode === 'parse') {
        const selectedSheet = inspection.recommendedSelection
          ? inspection.sheets.find((sheet) => sheet.sheetIndex === inspection.recommendedSelection?.sheetIndex)
          : inspection.sheets.find((sheet) => sheet.nonEmpty && sheet.state === 'visible')
            ?? inspection.sheets.find((sheet) => sheet.nonEmpty);
        const selectedHeader = selectedSheet?.headerCandidates[0];
        if (!selectedSheet || !selectedHeader) {
          profile.parseStatus = 'skipped';
          profile.parseErrorCode = 'no_header_candidate';
        } else {
          const parseStartedAt = performance.now();
          profile.selectedSheetIndex = selectedSheet.sheetIndex;
          profile.headerStartRowIndex = selectedHeader.startRowIndex;
          profile.headerRowIndex = selectedHeader.endRowIndex;
          try {
            const parsed = await parser.parse(buffer, {
              sheetIndex: selectedSheet.sheetIndex,
              headerStartRowIndex: selectedHeader.startRowIndex,
              headerRowIndex: selectedHeader.endRowIndex,
              allowHiddenSheet: selectedSheet.state !== 'visible',
              allowCachedFormulaResults: options.formulaResults === 'cached'
            });
            profile.parseStatus = 'passed';
            profile.parsedColumns = parsed.columns.length;
            profile.parsedRows = parsed.rows.length;
            profile.pendingRows = parsed.rows.filter((row) => row.status === 'pending').length;
            profile.errorRows = parsed.rows.filter((row) => row.status === 'error').length;
            profile.formulaErrorRows = parsed.rows.filter((row) => row.errors.some((error) => error.includes('公式单元格'))).length;
            profile.formulaWarningRows = parsed.rows.filter((row) => row.warnings.some((warning) => warning.includes('使用公式缓存结果'))).length;
            profile.mergedDataErrorRows = parsed.rows.filter((row) => row.errors.some((error) => error.includes('数据区合并单元格'))).length;
            profile.mergedDataWarningRows = parsed.rows.filter((row) => row.warnings.some((warning) => warning.includes('数据区包含合并单元格'))).length;
            profile.cellErrorRows = parsed.rows.filter((row) => row.errors.some((error) => error.includes('Excel 单元格错误'))).length;
            profile.otherErrorRows = parsed.rows.filter((row) => (
              row.status === 'error'
              && !row.errors.some((error) => error.includes('公式单元格') || error.includes('数据区合并单元格') || error.includes('Excel 单元格错误'))
            )).length;
            profile.duplicateRows = parsed.rows.filter((row) => row.status === 'duplicate').length;
            profile.ignoredRows = parsed.rows.filter((row) => row.status === 'ignored').length;
          } catch (error) {
            profile.parseStatus = 'failed';
            profile.parseErrorCategory = safeErrorCategory(error);
            profile.parseErrorCode = safeParserErrorCode(error);
          }
          profile.parseDurationMs = roundedDuration(parseStartedAt);
        }
      }
      const rssAfter = process.memoryUsage().rss;
      peakRssBytes = Math.max(peakRssBytes, rssAfter);
      profile.durationMs = roundedDuration(startedAt);
      profile.rssDeltaBytes = Math.max(0, rssAfter - rssBefore);
      profiles.push(profile);
    } catch (error) {
      const rssAfter = process.memoryUsage().rss;
      peakRssBytes = Math.max(peakRssBytes, rssAfter);
      profiles.push({
        sampleId: sample.sampleId,
        sizeBytes: sample.sizeBytes,
        status: 'failed',
        errorCategory: safeErrorCategory(error),
        durationMs: roundedDuration(startedAt),
        rssDeltaBytes: Math.max(0, rssAfter - rssBefore)
      });
    }
    if (hash(await readFile(absolutePath)) !== sample.sha256) {
      throw new Error(`Source changed during profile for ${sample.sampleId}`);
    }
  }

  const passed = profiles.filter((profile) => profile.status === 'passed');
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    limits: {
      minSizeMb: options.minSizeMb,
      maxSizeMb: options.maxSizeMb,
      mode: options.mode,
      formulaResults: options.formulaResults
    },
    aggregate: {
      eligibleSamples: profiles.length,
      passed: passed.length,
      failed: profiles.length - passed.length,
      totalBytes: profiles.reduce((sum, profile) => sum + profile.sizeBytes, 0),
      totalSheets: passed.reduce((sum, profile) => sum + (profile.sheetCount ?? 0), 0),
      selectionRequired: passed.filter((profile) => profile.requiresSheetSelection).length,
      sheetsWithoutHeaderCandidates: passed.reduce((sum, profile) => sum + (profile.sheetsWithoutHeaderCandidates ?? 0), 0),
      parsePassed: passed.filter((profile) => profile.parseStatus === 'passed').length,
      parseFailed: passed.filter((profile) => profile.parseStatus === 'failed').length,
      parseSkipped: passed.filter((profile) => profile.parseStatus === 'skipped').length,
      parsedRows: passed.reduce((sum, profile) => sum + (profile.parsedRows ?? 0), 0),
      pendingRows: passed.reduce((sum, profile) => sum + (profile.pendingRows ?? 0), 0),
      errorRows: passed.reduce((sum, profile) => sum + (profile.errorRows ?? 0), 0),
      duplicateRows: passed.reduce((sum, profile) => sum + (profile.duplicateRows ?? 0), 0),
      ignoredRows: passed.reduce((sum, profile) => sum + (profile.ignoredRows ?? 0), 0),
      formulaErrorRows: passed.reduce((sum, profile) => sum + (profile.formulaErrorRows ?? 0), 0),
      formulaWarningRows: passed.reduce((sum, profile) => sum + (profile.formulaWarningRows ?? 0), 0),
      mergedDataErrorRows: passed.reduce((sum, profile) => sum + (profile.mergedDataErrorRows ?? 0), 0),
      mergedDataWarningRows: passed.reduce((sum, profile) => sum + (profile.mergedDataWarningRows ?? 0), 0),
      cellErrorRows: passed.reduce((sum, profile) => sum + (profile.cellErrorRows ?? 0), 0),
      otherErrorRows: passed.reduce((sum, profile) => sum + (profile.otherErrorRows ?? 0), 0),
      maxDurationMs: Math.max(0, ...profiles.map((profile) => profile.durationMs)),
      maxObservedRssDeltaBytes: Math.max(0, ...profiles.map((profile) => profile.rssDeltaBytes)),
      peakProcessRssBytes: peakRssBytes
    },
    samples: profiles
  };

  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write([
    `XLSX profile completed: ${profiles.length} anonymous samples`,
    `Passed: ${result.aggregate.passed}; failed: ${result.aggregate.failed}`,
    `Selection required: ${result.aggregate.selectionRequired}`,
    `Parse passed/failed/skipped: ${result.aggregate.parsePassed}/${result.aggregate.parseFailed}/${result.aggregate.parseSkipped}`,
    `Local result: ${options.output}`
  ].join('\n') + '\n');
}

function parseOptions(args: string[]): CliOptions {
  const repositoryRoot = resolve(process.cwd(), '..');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid CLI argument near ${key}`);
    values.set(key, value);
    index += 1;
  }
  const minSizeMb = positiveNumber(values.get('--min-size-mb'), 0, '--min-size-mb', true);
  const maxSizeMb = positiveNumber(values.get('--max-size-mb'), 10, '--max-size-mb');
  const mode = values.get('--mode') ?? 'inspect';
  const formulaResults = values.get('--formula-results') ?? 'reject';
  if (!['inspect', 'parse'].includes(mode)) throw new Error('--mode must be inspect or parse');
  if (!['reject', 'cached'].includes(formulaResults)) throw new Error('--formula-results must be reject or cached');
  if (minSizeMb >= maxSizeMb) throw new Error('--min-size-mb must be lower than --max-size-mb');
  const manifest = values.get('--manifest');
  const output = values.get('--output');
  return {
    manifest: resolve(repositoryRoot, manifest ?? '.realdata-test/inventory.local.json'),
    output: resolve(repositoryRoot, output ?? '.realdata-test/xlsx-profile.local.json'),
    minSizeMb,
    maxSizeMb,
    mode: mode as CliOptions['mode'],
    formulaResults: formulaResults as CliOptions['formulaResults'],
    sampleId: values.get('--sample-id')
  };
}

function positiveNumber(value: string | undefined, fallback: number, name: string, allowZero = false) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} number`);
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
  const repositoryRoot = resolve(process.cwd(), '..');
  const localRoot = resolve(repositoryRoot, '.realdata-test');
  const relation = relative(localRoot, resolve(output));
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error('XLSX profile output must stay inside .realdata-test');
  }
}

function hash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function roundedDuration(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function safeErrorCategory(error: unknown) {
  if (!error || typeof error !== 'object') return 'unknown';
  const name = (error as { constructor?: { name?: string } }).constructor?.name;
  return name && /^[A-Za-z][A-Za-z0-9]+$/.test(name) ? name : 'unknown';
}

function safeParserErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('数据行不能超过')) return 'row_limit';
  if (message.includes('列数不能超过')) return 'column_limit';
  if (message.includes('表头')) return 'header_invalid';
  if (message.includes('工作表')) return 'sheet_invalid';
  if (message.includes('损坏') || message.includes('有效的 .xlsx')) return 'invalid_xlsx';
  return 'parse_rejected';
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown XLSX profile failure';
  process.stderr.write(`XLSX profile failed: ${message}\n`);
  process.exitCode = 1;
});
