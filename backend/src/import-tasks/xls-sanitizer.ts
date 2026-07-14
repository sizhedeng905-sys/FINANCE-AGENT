import * as XLSX from 'xlsx';

import { inspectOleCompoundFile, OleCompoundPolicyError } from '../files/ole-compound-security';

const OLE_COMPOUND_FILE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_WORKSHEET_ROWS = 50_050;
const MAX_COLUMNS = 200;
const MAX_CELLS = 1_000_000;
const MAX_FORMULAS = 100_000;
const MAX_MERGES = 10_000;
const MAX_CELL_TEXT_LENGTH = 10_000;
const MAX_FORMULA_LENGTH = 8_192;
const MAX_NUMBER_FORMAT_LENGTH = 255;
const ACTIVE_OR_EXTERNAL_FORMULA = /(?:\[[^\]]+\]|(?:https?|ftp|file):|\\\\|(?:^|[^A-Z0-9_.])(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|REGISTER(?:\.ID)?|EXEC|RUN|HALT|RETURN|GOTO|FORMULA|SET\.VALUE|SAVE|OPEN|FOPEN|FWRITE|APP\.ACTIVATE|SEND\.KEYS|GET\.CELL|FILTERXML|ENCODEURL)\s*\(|\|[^!]{0,512}!)/i;
const EXTERNAL_HYPERLINK = /^(?:https?|ftp|file|javascript|data):|^\\\\/i;

export interface XlsConversionMetadata extends Record<string, string | number | boolean> {
  sourceFormat: 'xls';
  outputFormat: 'xlsx';
  converter: 'sheetjs-sanitizer';
  converterVersion: string;
  sheetCount: number;
  visibleSheetCount: number;
  hiddenSheetCount: number;
  veryHiddenSheetCount: number;
  cellCount: number;
  formulaCellCount: number;
  mergeCount: number;
  strippedInternalHyperlinkCount: number;
  date1904: boolean;
}

export interface SanitizedXlsWorkbook {
  buffer: Buffer;
  metadata: XlsConversionMetadata;
}

export class XlsConversionPolicyError extends Error {}

interface MutableCounters {
  inspectedCellCount: number;
  cellCount: number;
  formulaCellCount: number;
  mergeCount: number;
  strippedInternalHyperlinkCount: number;
}

type SheetState = 0 | 1 | 2;

export function sanitizeLegacyWorkbookBuffer(buffer: Buffer): SanitizedXlsWorkbook {
  assertPolicy(buffer.length > 0 && buffer.length <= MAX_INPUT_BYTES, 'XLS 文件大小超出安全转换范围');
  assertPolicy(
    buffer.length >= 512 && buffer.subarray(0, OLE_COMPOUND_FILE_SIGNATURE.length).equals(OLE_COMPOUND_FILE_SIGNATURE),
    'XLS 文件不是受支持的 OLE 复合文档'
  );
  inspectCompoundFile(buffer);

  let source: XLSX.WorkBook;
  try {
    source = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
      bookFiles: true,
      bookVBA: true,
      nodim: true,
      WTF: true
    });
  } catch {
    throw new XlsConversionPolicyError('XLS 文件损坏、已加密或格式不受支持');
  }

  return sanitizeLegacyWorkbook(source);
}

export function sanitizeLegacyWorkbook(source: XLSX.WorkBook): SanitizedXlsWorkbook {
  assertPolicy(!source.vbaraw, 'XLS 文件包含 VBA 宏，禁止导入');
  assertPolicy(
    Array.isArray(source.SheetNames) && source.SheetNames.length > 0 && source.SheetNames.length <= MAX_SHEETS,
    `XLS 工作表数量必须在 1-${MAX_SHEETS} 之间`
  );
  assertSafeWorkbookNames(source);

  const target = XLSX.utils.book_new();
  const counters: MutableCounters = {
    inspectedCellCount: 0,
    cellCount: 0,
    formulaCellCount: 0,
    mergeCount: 0,
    strippedInternalHyperlinkCount: 0
  };
  const states: SheetState[] = [];

  for (let sheetIndex = 0; sheetIndex < source.SheetNames.length; sheetIndex += 1) {
    const sheetName = source.SheetNames[sheetIndex];
    assertPolicy(
      sheetName.length > 0 &&
        sheetName.length <= 31 &&
        !['__proto__', 'prototype', 'constructor'].includes(sheetName.toLowerCase()),
      'XLS 工作表名称不合法'
    );
    assertPolicy(Object.prototype.hasOwnProperty.call(source.Sheets, sheetName), 'XLS 工作表结构不完整');
    const worksheet = source.Sheets[sheetName];
    assertPolicy(Boolean(worksheet), 'XLS 工作表结构不完整');
    const state = normalizeSheetState(source.Workbook?.Sheets?.[sheetIndex]?.Hidden);
    states.push(state);
    XLSX.utils.book_append_sheet(target, sanitizeWorksheet(worksheet, counters), sheetName);
  }

  const date1904 = source.Workbook?.WBProps?.date1904 === true;
  target.Workbook = {
    WBProps: { date1904 },
    Sheets: source.SheetNames.map((name, index) => ({ name, Hidden: states[index] }))
  };

  let output: Buffer;
  try {
    output = XLSX.write(target, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
      cellDates: true
    }) as Buffer;
  } catch {
    throw new XlsConversionPolicyError('XLS 文件无法转换为安全工作簿');
  }

  return {
    buffer: output,
    metadata: {
      sourceFormat: 'xls',
      outputFormat: 'xlsx',
      converter: 'sheetjs-sanitizer',
      converterVersion: XLSX.version,
      sheetCount: source.SheetNames.length,
      visibleSheetCount: states.filter((state) => state === 0).length,
      hiddenSheetCount: states.filter((state) => state === 1).length,
      veryHiddenSheetCount: states.filter((state) => state === 2).length,
      cellCount: counters.cellCount,
      formulaCellCount: counters.formulaCellCount,
      mergeCount: counters.mergeCount,
      strippedInternalHyperlinkCount: counters.strippedInternalHyperlinkCount,
      date1904
    }
  };
}

function inspectCompoundFile(buffer: Buffer) {
  try {
    inspectOleCompoundFile(buffer);
  } catch (error) {
    if (error instanceof OleCompoundPolicyError) throw new XlsConversionPolicyError(error.message);
    throw new XlsConversionPolicyError('XLS 复合文档结构无法安全检查');
  }
}

function assertSafeWorkbookNames(workbook: XLSX.WorkBook) {
  const names = workbook.Workbook?.Names ?? [];
  for (const item of names) {
    const reference = String(item.Ref ?? '');
    assertPolicy(
      reference.length <= MAX_FORMULA_LENGTH && !ACTIVE_OR_EXTERNAL_FORMULA.test(reference),
      'XLS 文件包含外部名称引用'
    );
  }
}

function sanitizeWorksheet(source: XLSX.WorkSheet, counters: MutableCounters): XLSX.WorkSheet {
  assertPolicy(source['!type'] === undefined, 'XLS 文件包含宏、图表或对话工作表');
  const target: XLSX.WorkSheet = {};
  let maxRow = -1;
  let maxColumn = -1;

  for (const key of Object.keys(source)) {
    if (key.startsWith('!')) continue;
    assertPolicy(/^[A-Z]{1,3}[1-9]\d*$/.test(key), 'XLS 工作表包含非法单元格地址');
    let address: XLSX.CellAddress;
    try {
      address = XLSX.utils.decode_cell(key);
    } catch {
      throw new XlsConversionPolicyError('XLS 工作表包含非法单元格地址');
    }
    assertCellAddress(address);
    counters.inspectedCellCount += 1;
    assertPolicy(counters.inspectedCellCount <= MAX_CELLS, `XLS 单元格不能超过 ${MAX_CELLS}`);
    const cell = sanitizeCell(source[key] as XLSX.CellObject, counters);
    if (!cell) continue;
    counters.cellCount += 1;
    target[key] = cell;
    maxRow = Math.max(maxRow, address.r);
    maxColumn = Math.max(maxColumn, address.c);
  }

  const merges = (source['!merges'] ?? []).map((range) => sanitizeMerge(range));
  counters.mergeCount += merges.length;
  assertPolicy(counters.mergeCount <= MAX_MERGES, `XLS 合并区域不能超过 ${MAX_MERGES}`);
  for (const range of merges) {
    maxRow = Math.max(maxRow, range.e.r);
    maxColumn = Math.max(maxColumn, range.e.c);
  }
  if (merges.length > 0) target['!merges'] = merges;
  if (maxRow >= 0 && maxColumn >= 0) {
    target['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } });
  }
  return target;
}

function sanitizeCell(source: XLSX.CellObject, counters: MutableCounters): XLSX.CellObject | undefined {
  assertPolicy(Boolean(source) && typeof source === 'object', 'XLS 单元格结构不合法');
  if (source.l) {
    const target = String(source.l.Target ?? '');
    assertPolicy(!EXTERNAL_HYPERLINK.test(target), 'XLS 文件包含外部超链接');
    counters.strippedInternalHyperlinkCount += 1;
  }

  const formula = source.f === undefined ? undefined : String(source.f);
  if (formula !== undefined) {
    assertPolicy(
      formula.length > 0 &&
        formula.length <= MAX_FORMULA_LENGTH &&
        !formula.startsWith('=') &&
        !formula.includes('\u0000') &&
        !ACTIVE_OR_EXTERNAL_FORMULA.test(formula),
      'XLS 文件包含不安全或不受支持的公式'
    );
    counters.formulaCellCount += 1;
    assertPolicy(counters.formulaCellCount <= MAX_FORMULAS, `XLS 公式单元格不能超过 ${MAX_FORMULAS}`);
  }

  const clean = sanitizeCellValue(source, formula !== undefined);
  if (!clean && formula === undefined) return undefined;
  const target = clean ?? ({ t: 'n' } as XLSX.CellObject);
  if (formula !== undefined) target.f = formula;
  if (source.z !== undefined) {
    const numberFormat = String(source.z);
    assertPolicy(
      numberFormat.length <= MAX_NUMBER_FORMAT_LENGTH && !numberFormat.includes('\u0000'),
      'XLS 数字格式不合法'
    );
    target.z = numberFormat;
  }
  return target;
}

function sanitizeCellValue(source: XLSX.CellObject, formula: boolean): XLSX.CellObject | undefined {
  const type = String(source.t ?? inferCellType(source.v));
  const value = source.v;
  if (value === undefined || value === null) return formula ? ({ t: normalizeFormulaType(type) } as XLSX.CellObject) : undefined;

  if (type === 's' || type === 'str' || type === 'inlineStr') {
    const text = String(value);
    assertPolicy(text.length <= MAX_CELL_TEXT_LENGTH && !text.includes('\u0000'), 'XLS 单元格文本过长或不合法');
    return { t: formula && type === 'str' ? 'str' : 's', v: text } as XLSX.CellObject;
  }
  if (type === 'n') {
    assertPolicy(typeof value === 'number' && Number.isFinite(value), 'XLS 数值单元格不合法');
    return { t: 'n', v: value };
  }
  if (type === 'b') {
    assertPolicy(typeof value === 'boolean' || value === 0 || value === 1, 'XLS 布尔单元格不合法');
    return { t: 'b', v: Boolean(value) };
  }
  if (type === 'd') {
    const date = value instanceof Date ? value : new Date(String(value));
    assertPolicy(Number.isFinite(date.getTime()), 'XLS 日期单元格不合法');
    return { t: 'd', v: date } as XLSX.CellObject;
  }
  if (type === 'e') {
    assertPolicy(typeof value === 'number' || typeof value === 'string', 'XLS 错误单元格不合法');
    return { t: 'e', v: value } as XLSX.CellObject;
  }
  if (type === 'z') return formula ? ({ t: 'n' } as XLSX.CellObject) : undefined;
  throw new XlsConversionPolicyError('XLS 文件包含不受支持的单元格类型');
}

function sanitizeMerge(range: XLSX.Range): XLSX.Range {
  assertCellAddress(range.s);
  assertCellAddress(range.e);
  assertPolicy(range.s.r <= range.e.r && range.s.c <= range.e.c, 'XLS 合并区域不合法');
  return { s: { r: range.s.r, c: range.s.c }, e: { r: range.e.r, c: range.e.c } };
}

function assertCellAddress(address: XLSX.CellAddress) {
  assertPolicy(
    Number.isInteger(address.r) &&
      Number.isInteger(address.c) &&
      address.r >= 0 &&
      address.r < MAX_WORKSHEET_ROWS &&
      address.c >= 0 &&
      address.c < MAX_COLUMNS,
    `XLS 工作表范围不能超过 ${MAX_WORKSHEET_ROWS} 行、${MAX_COLUMNS} 列`
  );
}

function inferCellType(value: unknown) {
  if (typeof value === 'string') return 's';
  if (typeof value === 'number') return 'n';
  if (typeof value === 'boolean') return 'b';
  if (value instanceof Date) return 'd';
  return 'z';
}

function normalizeFormulaType(type: string): 'n' | 'str' | 'b' | 'e' {
  if (type === 'str' || type === 's' || type === 'inlineStr') return 'str';
  if (type === 'b') return 'b';
  if (type === 'e') return 'e';
  return 'n';
}

function normalizeSheetState(value: unknown): SheetState {
  return value === 1 ? 1 : value === 2 ? 2 : 0;
}

function assertPolicy(condition: unknown, message: string): asserts condition {
  if (!condition) throw new XlsConversionPolicyError(message);
}
