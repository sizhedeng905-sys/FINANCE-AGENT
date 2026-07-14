import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import ExcelJS from 'exceljs';

import { ExcelParserService } from '../src/import-tasks/excel-parser.service';

interface CliOptions {
  rows: number;
  batchSize: number;
  output: string;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const repositoryRoot = resolve(process.cwd(), '..');
  const localRoot = resolve(repositoryRoot, '.realdata-test');
  assertInsideLocalRoot(options.output, localRoot);
  const generatedDirectory = resolve(localRoot, 'generated');
  const fixturePath = resolve(generatedDirectory, `synthetic-${options.rows}-${process.pid}.xlsx`);
  await mkdir(generatedDirectory, { recursive: true, mode: 0o700 });

  try {
    await generateWorkbook(fixturePath, options.rows);
    const buffer = await readFile(fixturePath);
    const sourceHash = sha256(buffer);
    const parser = new ExcelParserService();
    const startedAt = performance.now();
    let peakRssBytes = process.memoryUsage().rss;
    let batches = 0;
    let parsedRows = 0;
    let pendingRows = 0;
    let errorRows = 0;
    let duplicateRows = 0;
    let ignoredRows = 0;
    let formulaWarningRows = 0;
    let firstRowNumber: number | undefined;
    let lastRowNumber: number | undefined;
    let previousProgress = 0;

    const parsed = await parser.parseInBatches(
      buffer,
      async (rows, progress) => {
        if (progress.processedRows <= previousProgress || progress.totalRows !== options.rows) {
          throw new Error('Non-monotonic parser progress');
        }
        previousProgress = progress.processedRows;
        batches += 1;
        parsedRows += rows.length;
        firstRowNumber ??= rows[0]?.rowNumber;
        lastRowNumber = rows.at(-1)?.rowNumber;
        pendingRows += rows.filter((row) => row.status === 'pending').length;
        errorRows += rows.filter((row) => row.status === 'error').length;
        duplicateRows += rows.filter((row) => row.status === 'duplicate').length;
        ignoredRows += rows.filter((row) => row.status === 'ignored').length;
        formulaWarningRows += rows.filter((row) => row.warnings.some((warning) => warning.includes('公式缓存结果'))).length;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      },
      { allowCachedFormulaResults: true },
      { batchSize: options.batchSize }
    );

    const unchanged = sha256(await readFile(fixturePath)) === sourceHash;
    if (!unchanged) throw new Error('Synthetic XLSX changed during profile');
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      fixture: {
        synthetic: true,
        rows: options.rows,
        columns: parsed.columns.length,
        bufferBytes: buffer.length
      },
      parser: {
        processingMode: parsed.processingMode,
        batchSize: options.batchSize,
        batches,
        parsedRows,
        pendingRows,
        errorRows,
        duplicateRows,
        ignoredRows,
        formulaWarningRows,
        firstRowNumber,
        lastRowNumber,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        peakProcessRssBytes: peakRssBytes
      },
      integrity: { sha256Unchanged: unchanged }
    };
    await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write([
      `Synthetic XLSX profile completed: ${options.rows} rows`,
      `Batches: ${batches}; parsed: ${parsedRows}; errors: ${errorRows}`,
      `Local result: ${options.output}`
    ].join('\n') + '\n');
  } finally {
    await rm(fixturePath, { force: true });
  }
}

async function generateWorkbook(path: string, rows: number) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: path,
    useStyles: false,
    useSharedStrings: false
  });
  const sheet = workbook.addWorksheet('Synthetic detail');
  sheet.addRow(['record_date', 'amount', 'reference', 'category', 'description', 'formula_amount']).commit();
  for (let index = 1; index <= rows; index += 1) {
    const excelRow = index + 1;
    sheet.addRow([
      `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
      index / 100,
      `SYN-${String(index).padStart(6, '0')}`,
      index % 2 === 0 ? 'transport' : 'labor',
      `synthetic-row-${index}`,
      { formula: `B${excelRow}*1`, result: index / 100 }
    ]).commit();
  }
  sheet.commit();
  await workbook.commit();
}

function parseOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid CLI argument near ${key}`);
    values.set(key, value);
    index += 1;
  }
  const rows = Number(values.get('--rows'));
  const batchSize = Number(values.get('--batch-size') ?? '500');
  if (!Number.isInteger(rows) || rows < 1 || rows > 50_000) throw new Error('--rows must be an integer from 1 to 50000');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error('--batch-size must be an integer from 1 to 1000');
  }
  const repositoryRoot = resolve(process.cwd(), '..');
  const output = resolve(
    repositoryRoot,
    values.get('--output') ?? `.realdata-test/large-xlsx-${rows}.local.json`
  );
  return { rows, batchSize, output };
}

function assertInsideLocalRoot(output: string, localRoot: string) {
  const path = relative(localRoot, output);
  if (!path || path.startsWith(`..${sep}`) || path === '..' || isAbsolute(path)) {
    throw new Error('Profile output must be a file inside .realdata-test');
  }
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Large XLSX profile failed'}\n`);
  process.exitCode = 1;
});
