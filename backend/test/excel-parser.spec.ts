import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { assertExcelDataRowLimit, ExcelParserService } from '../src/import-tasks/excel-parser.service';
import { readXlsxPackageMetadata } from '../src/import-tasks/xlsx-package-metadata';

describe('ExcelParserService phase 9', () => {
  const parser = new ExcelParserService();

  it('counts a merged formula only once at its master cell', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Merged formula');
    sheet.addRow(['金额', '说明']);
    sheet.getCell('A2').value = { formula: 'SUM(1,2)', result: 3 };
    sheet.mergeCells('A2:B2');

    const inspection = await parser.inspect(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(inspection.sheets[0]).toMatchObject({ formulaCellCount: 1, mergeCount: 1 });
  });

  it('preserves real rows and flags empty, duplicate, and formula rows deterministically', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('费用明细');
    sheet.addRow(['发生日期', '费用金额', '车牌', '司机', '上楼费', '上楼费']);
    sheet.addRow(['2026/07/01', 8200, '粤A12345', '王师傅', 300, 30]);
    sheet.addRow(['2026/07/02', '错误金额', '粤B77889', '刘师傅', 500, 50]);
    sheet.addRow(['']);
    sheet.addRow(['2026/07/01', 8200, '粤A12345', '王师傅', 300, 30]);
    const formulaRow = sheet.addRow(['2026/07/03', null, '粤C10001', '陈师傅', 200, 20]);
    formulaRow.getCell(2).value = { formula: 'SUM(4000,4000)', result: 8000 };

    const parsed = await parser.parse(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(parsed.sheet).toMatchObject({ sheetName: '费用明细', headerRowIndex: 1, rowCount: 5 });
    expect(parsed.columns).toHaveLength(6);
    expect(parsed.columns[4]).toMatchObject({ sourceName: '上楼费', sourceKey: '上楼费', duplicateName: true });
    expect(parsed.columns[5]).toMatchObject({ sourceName: '上楼费', sourceKey: '上楼费__2', duplicateName: true });
    expect(parsed.rows.map((row) => row.status)).toEqual(['pending', 'pending', 'ignored', 'duplicate', 'error']);
    expect(parsed.rows[2].warnings).toContain('空行已忽略');
    expect(parsed.rows[3].warnings).toContain('与本文件前一行内容重复，已跳过');
    expect(parsed.rows[4].rawData['费用金额']).toEqual({ formula: 'SUM(4000,4000)', result: 8000 });
    expect(parsed.rows[4].errors).toContain('公式单元格不自动执行，请转换为静态值后重新上传');
  });

  it('keeps values after row and column gaps without importing style-only tail cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sparse detail');
    sheet.getRow(1).values = ['Date', null, null, 'Amount'];
    sheet.getRow(5).values = ['2026-07-01', null, null, 1250];
    sheet.getCell('H20').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const inspection = await parser.inspect(buffer);
    expect(inspection.sheets[0]).toMatchObject({ rowCount: 5, columnCount: 4, nonEmpty: true });

    const parsed = await parser.parse(buffer, { headerRowIndex: 1 });
    expect(parsed.columns.map((column) => column.sourceName)).toEqual([
      'Date',
      '未命名列2',
      '未命名列3',
      'Amount'
    ]);
    expect(parsed.rows.map((row) => [row.rowNumber, row.status])).toEqual([
      [2, 'ignored'],
      [3, 'ignored'],
      [4, 'ignored'],
      [5, 'pending']
    ]);
    expect(parsed.rows[3].rawData.Amount).toBe(1250);
  });

  it('rejects an unselected multi-sheet workbook instead of silently dropping data', async () => {
    const multi = new ExcelJS.Workbook();
    multi.addWorksheet('一').addRow(['日期']);
    multi.addWorksheet('二').addRow(['金额']);
    await expect(parser.parse(Buffer.from(await multi.xlsx.writeBuffer()))).rejects.toThrow('请选择要导入的工作表');

    const merged = new ExcelJS.Workbook();
    const sheet = merged.addWorksheet('合并表头');
    sheet.addRow(['费用', '金额']);
    sheet.mergeCells('A1:B1');
    await expect(parser.parse(Buffer.from(await merged.xlsx.writeBuffer()))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces the documented column and row limits', async () => {
    expect(() => assertExcelDataRowLimit(4_999, 5_000)).not.toThrow();
    expect(() => assertExcelDataRowLimit(49_999, 50_000)).not.toThrow();
    expect(() => assertExcelDataRowLimit(50_000, 50_000)).not.toThrow();
    expect(() => assertExcelDataRowLimit(50_001, 50_000)).toThrow('Excel 数据行不能超过 50000');

    const wide = new ExcelJS.Workbook();
    wide.addWorksheet('超宽').addRow(Array.from({ length: 201 }, (_, index) => `字段${index + 1}`));
    await expect(parser.parse(Buffer.from(await wide.xlsx.writeBuffer()))).rejects.toThrow('Excel 列数不能超过 200');

    const tall = new ExcelJS.Workbook();
    const sheet = tall.addWorksheet('超长');
    sheet.addRow(['日期']);
    for (let index = 0; index < 5000; index += 1) sheet.addRow([`2026-07-${String((index % 28) + 1).padStart(2, '0')}`]);
    const atLimit = await parser.parse(Buffer.from(await tall.xlsx.writeBuffer()));
    expect(atLimit.rows).toHaveLength(5000);
    sheet.addRow(['2026-07-01']);
    const tallBuffer = Buffer.from(await tall.xlsx.writeBuffer());
    await expect(parser.parse(tallBuffer)).rejects.toThrow('Excel 数据行不能超过 5000');

    const batchSizes: number[] = [];
    const progressValues: number[] = [];
    const events: string[] = [];
    const parsed = await parser.parseInBatches(tallBuffer, async (rows, progress) => {
      events.push(`batch:${progress.processedRows}`);
      batchSizes.push(rows.length);
      progressValues.push(progress.processedRows);
    }, {}, {
      onStart: async (metadata) => {
        events.push('start');
        expect(metadata).toMatchObject({
          processingMode: 'streaming',
          sheet: { sheetName: '超长', headerRowIndex: 1, rowCount: 5001 },
          columns: [{ sourceName: '日期' }]
        });
      }
    });
    expect(parsed).toMatchObject({
      processingMode: 'streaming',
      sheet: { sheetName: '超长', headerRowIndex: 1, rowCount: 5001 }
    });
    expect(batchSizes).toEqual([...Array(10).fill(500), 1]);
    expect(progressValues.at(-1)).toBe(5001);
    expect(events[0]).toBe('start');
  });

  it('applies the same text limit to rich text and hyperlink cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('文本边界');
    sheet.addRow(['说明', '链接']);
    const row = sheet.addRow([]);
    row.getCell(1).value = { richText: [{ text: 'a'.repeat(20_000) }] };
    row.getCell(2).value = { text: 'b'.repeat(20_000), hyperlink: 'https://example.invalid' };

    const parsed = await parser.parse(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(parsed.rows[0].status).toBe('error');
    expect(parsed.rows[0].errors).toEqual(expect.arrayContaining([
      '说明：文本不能超过 10000 个字符',
      '链接：文本不能超过 10000 个字符'
    ]));
    expect(String(parsed.rows[0].rawData['说明'])).toHaveLength(10_000);
    expect(String(parsed.rows[0].rawData['链接'])).toHaveLength(10_000);
  });

  it('inspects every sheet and requires an explicit selection for multi-sheet workbooks', async () => {
    const workbook = new ExcelJS.Workbook();
    const detail = workbook.addWorksheet('Detail');
    detail.addRow(['Date', 'Cost', null]);
    detail.addRow([null, 'Transport', 'Labor']);
    detail.addRow(['2026-07-01', 120, 80]);
    detail.mergeCells('A1:A2');
    detail.mergeCells('B1:C1');
    const archive = workbook.addWorksheet('Archive');
    archive.state = 'hidden';
    archive.addRow(['Legacy date', 'Legacy amount']);
    archive.addRow(['2025-01-01', 10]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const inspection = await parser.inspect(buffer);

    expect(inspection.requiresSheetSelection).toBe(true);
    expect(inspection.sheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheetIndex: 0, sheetName: 'Detail', state: 'visible', rowCount: 3 }),
      expect.objectContaining({ sheetIndex: 1, sheetName: 'Archive', state: 'hidden', rowCount: 2 })
    ]));
    expect(inspection.sheets[0].headerCandidates).toContainEqual(expect.objectContaining({
      startRowIndex: 1,
      endRowIndex: 2,
      labels: ['Date', 'Cost / Transport', 'Cost / Labor']
    }));
    await expect(parser.parse(buffer)).rejects.toThrow('请选择要导入的工作表');
  });

  it('parses a selected merged header range and keeps hidden sheets opt-in', async () => {
    const workbook = new ExcelJS.Workbook();
    const detail = workbook.addWorksheet('Detail');
    detail.addRow(['Date', 'Cost', null]);
    detail.addRow([null, 'Transport', 'Labor']);
    detail.addRow(['2026-07-01', 120, 80]);
    detail.mergeCells('A1:A2');
    detail.mergeCells('B1:C1');
    const archive = workbook.addWorksheet('Archive');
    archive.state = 'veryHidden';
    archive.addRow(['Date', 'Amount']);
    archive.addRow(['2025-01-01', 10]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parser.parse(buffer, {
      sheetIndex: 0,
      headerStartRowIndex: 1,
      headerRowIndex: 2
    });

    expect(parsed.sheet).toMatchObject({ sheetName: 'Detail', sheetIndex: 0, headerRowIndex: 2, rowCount: 1 });
    expect(parsed.columns.map((column) => column.sourceName)).toEqual([
      'Date',
      'Cost / Transport',
      'Cost / Labor'
    ]);
    expect(parsed.rows[0]).toMatchObject({ rowNumber: 3, status: 'pending' });
    await expect(parser.parse(buffer, { sheetIndex: 1, headerRowIndex: 1 })).rejects.toThrow(
      '隐藏工作表必须显式确认'
    );
    await expect(parser.parse(buffer, {
      sheetIndex: 1,
      headerRowIndex: 1,
      allowHiddenSheet: true
    })).resolves.toMatchObject({ sheet: { sheetName: 'Archive', sheetIndex: 1 } });
  });

  it('uses cached formula results only after an explicit opt-in and preserves formula provenance', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Formula');
    sheet.addRow(['Date', 'Amount']);
    const cached = sheet.addRow(['2026-07-01', null]);
    cached.getCell(2).value = { formula: 'SUM(40,60)', result: 100 };
    const missing = sheet.addRow(['2026-07-02', null]);
    missing.getCell(2).value = { formula: 'SUM(50,50)' };
    const invalid = sheet.addRow(['2026-07-03', null]);
    invalid.getCell(2).value = { formula: '1/0', result: { error: '#DIV/0!' } };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const rejected = await parser.parse(buffer);
    expect(rejected.rows.map((row) => row.status)).toEqual(['error', 'error', 'error']);

    const accepted = await parser.parse(buffer, { allowCachedFormulaResults: true });
    expect(accepted.rows.map((row) => row.status)).toEqual(['pending', 'error', 'error']);
    expect(accepted.rows[0].rawData.Amount).toEqual({ formula: 'SUM(40,60)', result: 100 });
    expect(accepted.rows[0].warnings).toContain('Amount：使用公式缓存结果，确认前必须复核');
    expect(accepted.rows[1].errors).toContain('公式单元格缺少可用缓存结果');
    expect(accepted.rows[2].rawData.Amount).toEqual({ formula: '1/0', result: null });
    expect(accepted.rows[2].errors).toContain('Amount：公式缓存结果不可用');
  });

  it('does not treat a cached value with empty formula provenance as trustworthy', () => {
    const workbook = new ExcelJS.Workbook();
    const cell = workbook.addWorksheet('Formula boundary').getCell('A1');
    cell.value = { formula: '', result: 100 };
    const normalizeCell = (parser as unknown as {
      normalizeCell(target: ExcelJS.Cell): { formula: boolean; error?: string };
    }).normalizeCell.bind(parser);

    expect(normalizeCell(cell)).toMatchObject({ formula: true, error: '公式来源不可用' });
  });

  it('fails closed instead of stringifying an unresolved shared-string token', () => {
    const normalizeCell = (parser as unknown as {
      normalizeCell(target: ExcelJS.Cell): { value: unknown; displayValue: unknown; formula: boolean; error?: string };
    }).normalizeCell.bind(parser);
    const unresolved = {
      value: { sharedString: 7 },
      text: '{"sharedString":7}'
    } as unknown as ExcelJS.Cell;

    expect(normalizeCell(unresolved)).toEqual({
      value: null,
      displayValue: null,
      formula: false,
      error: 'Excel 共享字符串未解析，请重试或转人工处理'
    });
  });

  it('keeps only data-merge master values and defers importability to mapped-field validation', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Merged data');
    sheet.addRow(['Category', 'Amount']);
    sheet.addRow(['Transport', 100]);
    sheet.addRow([null, 200]);
    sheet.mergeCells('A2:A3');

    const parsed = await parser.parse(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(parsed.rows.map((row) => row.status)).toEqual(['pending', 'pending']);
    expect(parsed.rows[0].rawData.Category).toBe('Transport');
    expect(parsed.rows[1].rawData.Category).toBeNull();
    expect(parsed.rows.every((row) => row.warnings.includes('数据区包含合并单元格，确认前必须复核'))).toBe(true);
  });

  it('applies the explicit cached-result policy to formula headers', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Formula header');
    const header = sheet.addRow(['Date', null]);
    header.getCell(2).value = { formula: '"Amount"', result: 'Amount' };
    sheet.addRow(['2026-07-01', 100]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parser.parse(buffer)).rejects.toThrow('表头包含公式');
    await expect(parser.parse(buffer, { allowCachedFormulaResults: true })).resolves.toMatchObject({
      columns: [{ sourceName: 'Date' }, { sourceName: 'Amount' }],
      rows: [{ status: 'pending' }]
    });
  });

  it('streams workbooks with embedded media while preserving merges and formula provenance', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Media detail');
    sheet.addRow(['Cost', null, 'Date']);
    sheet.addRow(['Amount', 'Note', null]);
    const data = sheet.addRow([null, 'manual review', '2026-07-01']);
    data.getCell(1).value = {
      formula: 'LEN(B3)',
      result: 13,
      shareType: 'shared',
      ref: 'A3:A4'
    } as ExcelJS.CellValue;
    const sharedData = sheet.addRow([null, 'second review', '2026-07-02']);
    sharedData.getCell(1).value = { sharedFormula: 'A3', result: 13 };
    sheet.mergeCells('A1:B1');
    sheet.mergeCells('C1:C2');
    const imageId = workbook.addImage({
      extension: 'png',
      base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    });
    sheet.addImage(imageId, { tl: { col: 4, row: 0 }, ext: { width: 1, height: 1 } });
    sheet.getCell('F20').font = { bold: true };
    const archive = workbook.addWorksheet('Archive');
    archive.state = 'hidden';
    archive.addRows([['Date', 'Amount'], ['2025-01-01', 10]]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const metadata = await readXlsxPackageMetadata(buffer);
    expect(metadata.sharedStrings).toEqual(expect.arrayContaining([
      'Cost', 'Date', 'Amount', 'Note', 'manual review', 'second review'
    ]));
    const reader = (parser as unknown as {
      streamingWorkbookReader(input: Buffer, packageMetadata: typeof metadata): { sharedStrings: string[] };
    }).streamingWorkbookReader(buffer, metadata);
    expect(reader.sharedStrings).toEqual(metadata.sharedStrings);

    const inspection = await parser.inspect(buffer);
    expect(inspection).toMatchObject({
      processingMode: 'streaming',
      mediaCount: 1,
      requiresSheetSelection: true,
      sheets: [
        {
          sheetName: 'Media detail',
          rowCount: 4,
          columnCount: 3,
          mergeCount: 2,
          formulaCellCount: 2
        },
        { sheetName: 'Archive', state: 'hidden', rowCount: 2, columnCount: 2 }
      ]
    });
    expect(inspection.mediaExpandedBytes).toBeGreaterThan(0);

    const parsed = await parser.parse(buffer, {
      sheetIndex: 0,
      headerStartRowIndex: 1,
      headerRowIndex: 2,
      allowCachedFormulaResults: true
    });
    expect(parsed.columns.map((column) => column.sourceName)).toEqual(['Cost / Amount', 'Cost / Note', 'Date']);
    const repeated = await Promise.all(Array.from({ length: 4 }, () => parser.parse(buffer, {
      sheetIndex: 0,
      headerStartRowIndex: 1,
      headerRowIndex: 2,
      allowCachedFormulaResults: true
    })));
    expect(repeated.every((result) => (
      result.columns.map((column) => column.sourceName).join('|') === 'Cost / Amount|Cost / Note|Date'
    ))).toBe(true);
    const malformedArchive = await JSZip.loadAsync(buffer);
    malformedArchive.remove('xl/sharedStrings.xml');
    const malformed = await malformedArchive.generateAsync({ type: 'nodebuffer' });
    await expect(parser.parse(Buffer.from(malformed), {
      sheetIndex: 0,
      headerStartRowIndex: 1,
      headerRowIndex: 2,
      allowCachedFormulaResults: true
    })).rejects.toThrow('共享字符串引用元数据不合法');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      status: 'pending',
      rawData: { 'Cost / Amount': { formula: 'LEN(B3)', result: 13 } },
      warnings: ['Cost / Amount：使用公式缓存结果，确认前必须复核']
    });
    expect(parsed.rows[1]).toMatchObject({
      status: 'pending',
      rawData: { 'Cost / Amount': { formula: 'LEN(B4)', result: 13 } },
      warnings: ['Cost / Amount：使用公式缓存结果，确认前必须复核']
    });
    expect(parsed).toMatchObject({
      ir: {
        schemaVersion: 'excel-ir/1.0',
        parserVersion: 'exceljs-evidence-v1',
        sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        parserInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rowEvidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        hash: expect.stringMatching(/^[a-f0-9]{64}$/)
      },
      sheet: {
        stableId: 'sheet0',
        visibility: 'visible',
        headerStartRowIndex: 1,
        selectedHeaderRows: [1, 2],
        mergedRanges: ['A1:B1', 'C1:C2'],
        dateSystem: '1900',
        timezone: 'UTC'
      }
    });
    expect(parsed.columns[0]).toMatchObject({
      sourceColumnId: 'sheet0:A',
      columnLetter: 'A',
      headerParts: ['Cost', 'Amount'],
      statistics: { nonEmpty: 2, empty: 0, distinctApprox: 2, distinctCapped: false }
    });
    expect(parsed.rows[0].cellEvidence[0]).toMatchObject({
      sourceRef: 'sheet0!A3',
      address: 'A3',
      parsedType: 'formula',
      formula: 'LEN(B3)',
      cachedValuePresent: true,
      cachedValue: '13',
      canonicalValue: '13',
      lexicalValue: '13',
      mergeAnchorAddress: null
    });
  });

  it('produces stable evidence hashes, decimal-string cells, and explicit 1904 date provenance', async () => {
    const workbook = new ExcelJS.Workbook();
    (workbook.properties as { date1904?: boolean }).date1904 = true;
    const sheet = workbook.addWorksheet('Evidence');
    sheet.addRow(['Date', 'Amount', 'Long note']);
    const row = sheet.addRow([new Date(Date.UTC(2026, 6, 18)), 125.6, 'x'.repeat(2_100)]);
    row.getCell(2).numFmt = '0.00';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const first = await parser.parse(buffer);
    const second = await parser.parse(buffer);

    expect(first.ir).toEqual(second.ir);
    expect(first.sheet).toMatchObject({ dateSystem: '1904', selectedHeaderRows: [1] });
    expect(first.rows[0].cellEvidence[0]).toMatchObject({
      address: 'A2',
      parsedType: 'date',
      canonicalValue: '2026-07-18'
    });
    expect(first.rows[0].cellEvidence[1]).toMatchObject({
      address: 'B2',
      parsedType: 'number',
      canonicalValue: '125.6',
      displayValue: '125.6'
    });
    expect(first.rows[0].cellEvidence[2]).toMatchObject({
      address: 'C2',
      truncated: true,
      lexicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(first.rows[0].cellEvidence[2].lexicalValue).toHaveLength(2_000);
    expect(first.rows[0].evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
