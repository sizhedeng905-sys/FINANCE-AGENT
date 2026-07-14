import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { ExcelParserService } from '../src/import-tasks/excel-parser.service';

describe('ExcelParserService phase 9', () => {
  const parser = new ExcelParserService();

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

  it('rejects multi-sheet and merged-header workbooks instead of silently dropping data', async () => {
    const multi = new ExcelJS.Workbook();
    multi.addWorksheet('一').addRow(['日期']);
    multi.addWorksheet('二').addRow(['金额']);
    await expect(parser.parse(Buffer.from(await multi.xlsx.writeBuffer()))).rejects.toThrow('仅支持一个非空 Sheet');

    const merged = new ExcelJS.Workbook();
    const sheet = merged.addWorksheet('合并表头');
    sheet.addRow(['费用', '金额']);
    sheet.mergeCells('A1:B1');
    await expect(parser.parse(Buffer.from(await merged.xlsx.writeBuffer()))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces the documented column and row limits', async () => {
    const wide = new ExcelJS.Workbook();
    wide.addWorksheet('超宽').addRow(Array.from({ length: 201 }, (_, index) => `字段${index + 1}`));
    await expect(parser.parse(Buffer.from(await wide.xlsx.writeBuffer()))).rejects.toThrow('Excel 列数不能超过 200');

    const tall = new ExcelJS.Workbook();
    const sheet = tall.addWorksheet('超长');
    sheet.addRow(['日期']);
    for (let index = 0; index < 5001; index += 1) sheet.addRow([`2026-07-${String((index % 28) + 1).padStart(2, '0')}`]);
    await expect(parser.parse(Buffer.from(await tall.xlsx.writeBuffer()))).rejects.toThrow('Excel 数据行不能超过 5000');
  });
});
