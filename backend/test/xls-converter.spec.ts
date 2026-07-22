import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

import { FileSecurityService } from '../src/files/file-security.service';
import { XlsConverterService } from '../src/import-tasks/xls-converter.service';
import {
  sanitizeLegacyWorkbook,
  XlsConversionPolicyError
} from '../src/import-tasks/xls-sanitizer';

describe('XlsConverterService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'xlsConverter.timeoutMs') return 30_000;
      if (key === 'xlsConverter.maxOutputMb') return 10;
      return undefined;
    })
  } as unknown as ConfigService;

  it('converts BIFF8 in a resource-limited child process and preserves safe workbook structure', async () => {
    const scan = jest.fn().mockResolvedValue(undefined);
    const converter = new XlsConverterService(config, { scan } as unknown as FileSecurityService);
    const workbook = XLSX.utils.book_new();
    const data = XLSX.utils.aoa_to_sheet([
      ['日期', '金额'],
      ['2026-01-02', 128.5]
    ]);
    data['!merges'] = [XLSX.utils.decode_range('A3:B3')];
    XLSX.utils.book_append_sheet(workbook, data, 'Data');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['internal']]), 'Hidden');
    workbook.Workbook = { Sheets: [{ name: 'Data', Hidden: 0 }, { name: 'Hidden', Hidden: 1 }] };
    const source = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;

    const converted = await converter.convert(source);

    expect(converted.metadata).toMatchObject({
      sourceFormat: 'xls',
      outputFormat: 'xlsx',
      converterVersion: '0.20.3',
      sheetCount: 2,
      hiddenSheetCount: 1,
      mergeCount: 1
    });
    expect(scan).toHaveBeenCalledWith('sanitized.xlsx', converted.buffer);
    const parsed = XLSX.read(converted.buffer, { type: 'buffer' });
    expect(parsed.SheetNames).toEqual(['Data', 'Hidden']);
    expect(parsed.Workbook?.Sheets?.map((sheet) => sheet.Hidden)).toEqual([0, 1]);
    expect(parsed.Sheets.Data['!merges']).toHaveLength(1);
    expect(parsed.Sheets.Data.B2.v).toBe(128.5);
  });

  it('preserves formula provenance and cached values while dropping unrelated workbook features', async () => {
    const source = XLSX.utils.book_new();
    const sheet: XLSX.WorkSheet = {
      A1: { t: 's', v: '金额' },
      A2: { t: 'n', v: 10 },
      A3: { t: 'n', f: 'SUM(A2:A2)', v: 10, z: '0.00' },
      '!ref': 'A1:A3'
    };
    XLSX.utils.book_append_sheet(source, sheet, 'Data');
    source.Workbook = {
      Sheets: [{ name: 'Data', Hidden: 0 }],
      Names: [{ Name: 'discarded_name', Ref: 'Data!$A$2' }],
      WBProps: { date1904: false }
    };

    const converted = sanitizeLegacyWorkbook(source);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(converted.buffer as unknown as ExcelJS.Buffer);
    const formula = workbook.getWorksheet('Data')?.getCell('A3').value;

    expect(formula).toMatchObject({ formula: 'SUM(A2:A2)', result: 10 });
    expect(workbook.definedNames.getNames('discarded_name')).toEqual([]);
    expect(converted.metadata.formulaCellCount).toBe(1);
  });

  it('rejects external formulas, hyperlinks, macros, and malformed source bytes', async () => {
    const externalFormula = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(externalFormula, {
      A1: { t: 'n', f: '[external.xls]Data!A1', v: 1 },
      '!ref': 'A1:A1'
    }, 'Data');
    expect(() => sanitizeLegacyWorkbook(externalFormula)).toThrow(XlsConversionPolicyError);

    const externalLink = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(externalLink, {
      A1: { t: 's', v: 'link', l: { Target: 'https://example.invalid/data' } },
      '!ref': 'A1:A1'
    }, 'Data');
    expect(() => sanitizeLegacyWorkbook(externalLink)).toThrow('外部超链接');

    const macro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(macro, XLSX.utils.aoa_to_sheet([[1]]), 'Data');
    macro.vbaraw = Buffer.from('macro');
    expect(() => sanitizeLegacyWorkbook(macro)).toThrow('VBA 宏');

    const macroSheet = XLSX.utils.book_new();
    const macroWorksheet = XLSX.utils.aoa_to_sheet([['macro']]);
    (macroWorksheet as unknown as Record<string, unknown>)['!type'] = 'macro';
    XLSX.utils.book_append_sheet(macroSheet, macroWorksheet, 'Macro1');
    expect(() => sanitizeLegacyWorkbook(macroSheet)).toThrow('宏、图表或对话工作表');

    const converter = new XlsConverterService(config, {
      scan: jest.fn()
    } as unknown as FileSecurityService);
    await expect(converter.convert(Buffer.from('not an xls'))).rejects.toBeInstanceOf(BadRequestException);

    const cleanWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(cleanWorkbook, XLSX.utils.aoa_to_sheet([[1]]), 'Data');
    const cleanLegacy = XLSX.write(cleanWorkbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    const container = XLSX.CFB.read(cleanLegacy, { type: 'buffer' });
    XLSX.CFB.utils.cfb_add(container, 'VBA_PROJECT', Buffer.from('synthetic macro marker'));
    await expect(converter.convert(XLSX.CFB.write(container, { type: 'buffer' }) as Buffer))
      .rejects.toThrow('宏、嵌入对象或加密内容');
  });
});
