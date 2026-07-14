import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';

const MAX_COLUMNS = 200;
const MAX_ROWS = 5000;
const MAX_CELL_TEXT_LENGTH = 10000;

export type ParsedCellValue = string | number | boolean | null | Record<string, unknown>;

export interface ParsedImportColumn {
  columnIndex: number;
  sourceKey: string;
  sourceName: string;
  normalizedName: string;
  sampleValues: Array<string | number | boolean>;
  inferredType: 'date' | 'number' | 'text';
  duplicateName: boolean;
}

export interface ParsedImportRow {
  rowNumber: number;
  rawData: Record<string, ParsedCellValue>;
  rowHash: string;
  status: 'pending' | 'error' | 'duplicate' | 'ignored';
  errors: string[];
  warnings: string[];
}

export interface ParsedWorkbook {
  sheet: {
    sheetName: string;
    sheetIndex: number;
    headerRowIndex: number;
    rowCount: number;
  };
  columns: ParsedImportColumn[];
  rows: ParsedImportRow[];
}

interface NormalizedCell {
  value: ParsedCellValue;
  displayValue: string | number | boolean | null;
  formula: boolean;
  error?: string;
}

@Injectable()
export class ExcelParserService {
  async parse(buffer: Buffer): Promise<ParsedWorkbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('Excel 文件内容损坏或不是有效的 .xlsx 文件');
    }

    const nonEmptySheets = workbook.worksheets.filter((sheet) => sheet.actualRowCount > 0);
    if (nonEmptySheets.length === 0) throw new BadRequestException('Excel 文件没有可解析的工作表');
    if (nonEmptySheets.length > 1) throw new BadRequestException('第一版仅支持一个非空 Sheet');

    const worksheet = nonEmptySheets[0];
    const merges = (worksheet.model as { merges?: string[] }).merges ?? [];
    if (merges.length > 0) throw new BadRequestException('第一版不支持合并单元格，请先整理为标准单行表头');

    const header = worksheet.getRow(1);
    const columnCount = Math.max(header.cellCount, worksheet.actualColumnCount);
    if (columnCount === 0) throw new BadRequestException('Excel 第一行必须是表头');
    if (columnCount > MAX_COLUMNS) throw new BadRequestException(`Excel 列数不能超过 ${MAX_COLUMNS}`);
    if (worksheet.actualRowCount - 1 > MAX_ROWS) throw new BadRequestException(`Excel 数据行不能超过 ${MAX_ROWS}`);

    const columns = this.parseHeaders(header, columnCount);
    const rows: ParsedImportRow[] = [];
    const seenHashes = new Set<string>();

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const rawData: Record<string, ParsedCellValue> = {};
      const errors: string[] = [];
      let hasFormula = false;
      let hasValue = false;

      for (const column of columns) {
        const normalized = this.normalizeCell(row.getCell(column.columnIndex));
        rawData[column.sourceKey] = normalized.value;
        if (normalized.displayValue !== null && normalized.displayValue !== '') {
          hasValue = true;
          if (column.sampleValues.length < 5) column.sampleValues.push(normalized.displayValue);
        }
        if (normalized.formula) hasFormula = true;
        if (normalized.error) errors.push(`${column.sourceName}：${normalized.error}`);
      }

      const rowHash = createHash('sha256')
        .update(JSON.stringify(columns.map((column) => [column.sourceKey, rawData[column.sourceKey]])))
        .digest('hex');
      let status: ParsedImportRow['status'] = 'pending';
      const warnings: string[] = [];

      if (!hasValue) {
        status = 'ignored';
        warnings.push('空行已忽略');
      } else if (hasFormula || errors.length > 0) {
        status = 'error';
        if (hasFormula) errors.push('公式单元格不自动执行，请转换为静态值后重新上传');
      } else if (seenHashes.has(rowHash)) {
        status = 'duplicate';
        warnings.push('与本文件前一行内容重复，已跳过');
      }

      if (hasValue) seenHashes.add(rowHash);
      rows.push({ rowNumber, rawData, rowHash, status, errors: [...new Set(errors)], warnings });
    }

    for (const column of columns) {
      column.inferredType = this.inferType(column.sampleValues);
    }

    return {
      sheet: {
        sheetName: worksheet.name,
        sheetIndex: worksheet.id - 1,
        headerRowIndex: 1,
        rowCount: rows.length
      },
      columns,
      rows
    };
  }

  normalizeHeader(value: string) {
    return value
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-—/\\()（）\[\]【】:：,.，。]+/g, '');
  }

  private parseHeaders(header: ExcelJS.Row, columnCount: number): ParsedImportColumn[] {
    const occurrences = new Map<string, number>();
    const columns: ParsedImportColumn[] = [];

    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const cell = this.normalizeCell(header.getCell(columnIndex));
      if (cell.formula || cell.error) throw new BadRequestException(`第 ${columnIndex} 列表头不合法`);
      const sourceName = String(cell.displayValue ?? '').trim() || `未命名列${columnIndex}`;
      if (sourceName.length > 128) throw new BadRequestException(`第 ${columnIndex} 列表头不能超过 128 个字符`);
      const normalizedName = this.normalizeHeader(sourceName);
      const occurrence = (occurrences.get(normalizedName) ?? 0) + 1;
      occurrences.set(normalizedName, occurrence);
      columns.push({
        columnIndex,
        sourceKey: occurrence === 1 ? sourceName : `${sourceName}__${occurrence}`,
        sourceName,
        normalizedName,
        sampleValues: [],
        inferredType: 'text',
        duplicateName: false
      });
    }

    const duplicateNames = new Set(
      [...occurrences.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    );
    columns.forEach((column) => {
      column.duplicateName = duplicateNames.has(column.normalizedName);
    });
    return columns;
  }

  private normalizeCell(cell: ExcelJS.Cell): NormalizedCell {
    const value = cell.value;
    if (value === null || value === undefined) return { value: null, displayValue: null, formula: false };
    if (value instanceof Date) {
      const date = this.formatDate(value);
      return { value: date, displayValue: date, formula: false };
    }
    if (typeof value === 'string') {
      return this.normalizeTextCell(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return { value, displayValue: value, formula: false };
    }
    if ('formula' in value || 'sharedFormula' in value) {
      const formula = 'formula' in value ? value.formula : value.sharedFormula;
      const result = 'result' in value ? this.jsonSafe(value.result) : null;
      return {
        value: { formula: String(formula ?? ''), result },
        displayValue: result === null ? `[公式] ${String(formula ?? '')}` : String(result),
        formula: true
      };
    }
    if ('richText' in value) {
      const text = value.richText.map((part) => part.text).join('');
      return this.normalizeTextCell(text);
    }
    if ('hyperlink' in value) {
      const text = value.text || value.hyperlink;
      return this.normalizeTextCell(text);
    }
    if ('error' in value) {
      return { value: { error: value.error }, displayValue: value.error, formula: false, error: 'Excel 单元格错误' };
    }
    return this.normalizeTextCell(String(cell.text));
  }

  private normalizeTextCell(value: string): NormalizedCell {
    if (value.length > MAX_CELL_TEXT_LENGTH) {
      return {
        value: value.slice(0, MAX_CELL_TEXT_LENGTH),
        displayValue: value.slice(0, 200),
        formula: false,
        error: `文本不能超过 ${MAX_CELL_TEXT_LENGTH} 个字符`
      };
    }
    return { value, displayValue: value, formula: false };
  }

  private inferType(values: Array<string | number | boolean>): 'date' | 'number' | 'text' {
    if (values.length === 0) return 'text';
    if (values.every((value) => typeof value === 'number' || this.isNumericString(value))) return 'number';
    if (values.every((value) => typeof value === 'string' && this.isDateString(value))) return 'date';
    return 'text';
  }

  private isNumericString(value: string | number | boolean) {
    return typeof value === 'string' && /^[-+]?\d{1,15}(?:,\d{3})*(?:\.\d+)?$/.test(value.trim());
  }

  private isDateString(value: string) {
    const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  private formatDate(value: Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private jsonSafe(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return this.formatDate(value);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    return String(value);
  }
}
