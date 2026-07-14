import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

import {
  readXlsxArchiveSummary,
  readXlsxPackageMetadata,
  XlsxArchiveSummary,
  XlsxPackageMetadata,
  XlsxPackageSheet
} from './xlsx-package-metadata';

const MAX_COLUMNS = 200;
const MAX_ROWS = 5000;
const MAX_CELL_TEXT_LENGTH = 10000;
const MAX_HEADER_SCAN_ROWS = 30;
const MAX_HEADER_CANDIDATES = 5;
const STREAMING_WORKBOOK_THRESHOLD_BYTES = 10 * 1024 * 1024;
const STREAMING_HEADER_SNAPSHOT_ROWS = MAX_HEADER_SCAN_ROWS + 3;

export type ParsedCellValue = string | number | boolean | null | Record<string, unknown>;
export type WorkbookSheetState = 'visible' | 'hidden' | 'veryHidden';

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
  processingMode: 'document' | 'streaming';
  sheet: {
    sheetName: string;
    sheetIndex: number;
    headerRowIndex: number;
    rowCount: number;
  };
  columns: ParsedImportColumn[];
  rows: ParsedImportRow[];
}

export interface WorkbookHeaderCandidate {
  startRowIndex: number;
  endRowIndex: number;
  columnCount: number;
  labels: string[];
  score: number;
  merged: boolean;
}

export interface WorkbookSheetInspection {
  sheetName: string;
  sheetIndex: number;
  state: WorkbookSheetState;
  rowCount: number;
  columnCount: number;
  nonEmpty: boolean;
  mergeCount: number;
  formulaCellCount: number;
  headerCandidates: WorkbookHeaderCandidate[];
}

export interface WorkbookInspection {
  sheets: WorkbookSheetInspection[];
  requiresSheetSelection: boolean;
  processingMode: 'document' | 'streaming';
  mediaCount: number;
  mediaExpandedBytes: number;
  recommendedSelection?: {
    sheetIndex: number;
    headerStartRowIndex: number;
    headerRowIndex: number;
  };
}

export interface ParseWorkbookOptions {
  sheetIndex?: number;
  headerStartRowIndex?: number;
  headerRowIndex?: number;
  allowHiddenSheet?: boolean;
  allowCachedFormulaResults?: boolean;
}

interface NormalizedCell {
  value: ParsedCellValue;
  displayValue: string | number | boolean | null;
  formula: boolean;
  formulaResultAvailable?: boolean;
  error?: string;
}

interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface WorksheetBounds {
  rowCount: number;
  columnCount: number;
  nonEmpty: boolean;
}

interface StreamingSheetObservation {
  metadata: XlsxPackageSheet;
  snapshot: ExcelJS.Worksheet;
  rowCount: number;
  columnCount: number;
  nonEmpty: boolean;
}

interface StreamingInspectionState {
  inspection: WorkbookInspection;
  observations: Map<number, StreamingSheetObservation>;
}

type StreamingWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & {
  name: string;
};

export class WorkbookSelectionRequiredException extends BadRequestException {}

@Injectable()
export class ExcelParserService {
  async inspect(buffer: Buffer): Promise<WorkbookInspection> {
    const archive = await readXlsxArchiveSummary(buffer);
    if (this.shouldStream(buffer, archive)) {
      const metadata = await readXlsxPackageMetadata(buffer);
      return (await this.inspectStreaming(buffer, metadata)).inspection;
    }
    return this.inspectDocument(buffer, archive);
  }

  private async inspectDocument(buffer: Buffer, archive: XlsxArchiveSummary): Promise<WorkbookInspection> {
    const workbook = await this.loadWorkbook(buffer);
    const sheets = workbook.worksheets.map((worksheet, sheetIndex) => this.inspectSheet(worksheet, sheetIndex));
    const nonEmptySheets = sheets.filter((sheet) => sheet.nonEmpty);
    const visibleSheets = nonEmptySheets.filter((sheet) => sheet.state === 'visible');
    const recommendedSheet = visibleSheets.length === 1 ? visibleSheets[0] : undefined;
    const candidate = recommendedSheet?.headerCandidates[0];

    return {
      sheets,
      requiresSheetSelection: nonEmptySheets.length !== 1 || nonEmptySheets[0]?.state !== 'visible',
      processingMode: 'document',
      mediaCount: archive.mediaCount,
      mediaExpandedBytes: archive.mediaExpandedBytes,
      recommendedSelection: recommendedSheet && candidate ? {
        sheetIndex: recommendedSheet.sheetIndex,
        headerStartRowIndex: candidate.startRowIndex,
        headerRowIndex: candidate.endRowIndex
      } : undefined
    };
  }

  async parse(buffer: Buffer, options: ParseWorkbookOptions = {}): Promise<ParsedWorkbook> {
    const archive = await readXlsxArchiveSummary(buffer);
    if (this.shouldStream(buffer, archive)) {
      const metadata = await readXlsxPackageMetadata(buffer);
      return this.parseStreaming(buffer, metadata, options);
    }
    return this.parseDocument(buffer, options);
  }

  private async parseDocument(buffer: Buffer, options: ParseWorkbookOptions): Promise<ParsedWorkbook> {
    const workbook = await this.loadWorkbook(buffer);
    const inspectedSheets = workbook.worksheets.map((worksheet, sheetIndex) => this.inspectSheet(worksheet, sheetIndex));
    const nonEmptySheets = inspectedSheets.filter((sheet) => sheet.nonEmpty);
    if (nonEmptySheets.length === 0) throw new BadRequestException('Excel 文件没有可解析的工作表');

    const selected = this.selectWorksheet(workbook, nonEmptySheets, options);
    const worksheet = selected.worksheet;
    if (worksheet.state !== 'visible' && !options.allowHiddenSheet) {
      throw new WorkbookSelectionRequiredException('隐藏工作表必须显式确认后才能导入');
    }

    const { rowCount, columnCount } = selected.inspection;
    if (columnCount === 0) throw new BadRequestException('Excel 表头不能为空');
    if (columnCount > MAX_COLUMNS) throw new BadRequestException(`Excel 列数不能超过 ${MAX_COLUMNS}`);
    const recommended = selected.inspection.headerCandidates[0];
    const headerRowIndex = options.headerRowIndex ?? recommended?.endRowIndex;
    if (!headerRowIndex) throw new WorkbookSelectionRequiredException('请选择有效的表头行');
    const candidateForEnd = selected.inspection.headerCandidates.find((candidate) => candidate.endRowIndex === headerRowIndex);
    const headerStartRowIndex = options.headerStartRowIndex ?? candidateForEnd?.startRowIndex ?? headerRowIndex;
    this.validateHeaderRangeValues(headerStartRowIndex, headerRowIndex, rowCount);
    this.validateHeaderFormulaResults(
      worksheet,
      headerStartRowIndex,
      headerRowIndex,
      columnCount,
      options.allowCachedFormulaResults ?? false
    );

    if (rowCount - headerRowIndex > MAX_ROWS) {
      throw new BadRequestException(`Excel 数据行不能超过 ${MAX_ROWS}`);
    }

    const ranges = this.mergeRanges(worksheet);
    const columns = this.parseHeaders(worksheet, headerStartRowIndex, headerRowIndex, columnCount, ranges);
    const rows: ParsedImportRow[] = [];
    const seenHashes = new Set<string>();
    const dataMergesByRow = this.indexDataMerges(ranges, headerRowIndex + 1, rowCount);

    for (let rowNumber = headerRowIndex + 1; rowNumber <= rowCount; rowNumber += 1) {
      rows.push(this.parseDataRow(
        worksheet.getRow(rowNumber),
        rowNumber,
        columns,
        dataMergesByRow,
        options,
        seenHashes
      ));
    }

    for (const column of columns) column.inferredType = this.inferType(column.sampleValues);

    return {
      processingMode: 'document',
      sheet: {
        sheetName: worksheet.name,
        sheetIndex: selected.sheetIndex,
        headerRowIndex,
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
      .replace(/[\s_\-—/\\()（）\[\]【】、:：,.，。]+/g, '');
  }

  private parseDataRow(
    row: ExcelJS.Row | undefined,
    rowNumber: number,
    columns: ParsedImportColumn[],
    dataMergesByRow: Map<number, CellRange[]>,
    options: ParseWorkbookOptions,
    seenHashes: Set<string>,
    formulaOverrides?: ReadonlyMap<string, string>
  ): ParsedImportRow {
    const rawData: Record<string, ParsedCellValue> = {};
    const errors: string[] = [];
    const warnings: string[] = [];
    let hasRejectedFormula = false;
    let hasFormulaWithoutResult = false;
    let hasDataMerge = false;
    let hasValue = false;

    for (const column of columns) {
      const merge = dataMergesByRow.get(rowNumber)?.find((range) => (
        column.columnIndex >= range.left && column.columnIndex <= range.right
      ));
      const isMergeMaster = !merge || (rowNumber === merge.top && column.columnIndex === merge.left);
      const normalized: NormalizedCell = !row || (merge && !isMergeMaster)
        ? { value: null, displayValue: null, formula: false }
        : this.normalizeCell(
          row.getCell(column.columnIndex),
          formulaOverrides?.get(row.getCell(column.columnIndex).address)
        );
      rawData[column.sourceKey] = normalized.value;
      if (normalized.displayValue !== null && normalized.displayValue !== '') {
        hasValue = true;
        if (column.sampleValues.length < 5) column.sampleValues.push(normalized.displayValue);
      }
      if (normalized.formula) {
        if (normalized.formulaResultAvailable && options.allowCachedFormulaResults) {
          warnings.push(`${column.sourceName}：使用公式缓存结果，确认前必须复核`);
        } else {
          hasRejectedFormula = true;
          hasFormulaWithoutResult ||= !normalized.formulaResultAvailable && !normalized.error;
        }
      }
      if (normalized.error) errors.push(`${column.sourceName}：${normalized.error}`);
      if (merge) hasDataMerge = true;
    }
    if (hasDataMerge) warnings.push('数据区包含合并单元格，确认前必须复核');

    const rowHash = createHash('sha256')
      .update(JSON.stringify(columns.map((column) => [column.sourceKey, rawData[column.sourceKey]])))
      .digest('hex');
    let status: ParsedImportRow['status'] = 'pending';

    if (!hasValue) {
      status = 'ignored';
      warnings.push('空行已忽略');
    } else if (hasRejectedFormula || errors.length > 0) {
      status = 'error';
      if (hasFormulaWithoutResult) errors.push('公式单元格缺少可用缓存结果');
      else if (hasRejectedFormula) errors.push('公式单元格不自动执行，请转换为静态值后重新上传');
    } else if (seenHashes.has(rowHash)) {
      status = 'duplicate';
      warnings.push('与本文件前一行内容重复，已跳过');
    }

    if (hasValue) seenHashes.add(rowHash);
    return { rowNumber, rawData, rowHash, status, errors: [...new Set(errors)], warnings };
  }

  private async loadWorkbook(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
      return workbook;
    } catch {
      throw new BadRequestException('Excel 文件内容损坏或不是有效的 .xlsx 文件');
    }
  }

  private shouldStream(buffer: Buffer, archive: XlsxArchiveSummary) {
    return buffer.length > STREAMING_WORKBOOK_THRESHOLD_BYTES || archive.mediaCount > 0;
  }

  private async inspectStreaming(
    buffer: Buffer,
    metadata: XlsxPackageMetadata
  ): Promise<StreamingInspectionState> {
    const observations = new Map<number, StreamingSheetObservation>();
    const metadataByName = new Map(metadata.sheets.map((sheet) => [sheet.sheetName, sheet]));
    try {
      const reader = this.streamingWorkbookReader(buffer, metadata);
      for await (const worksheet of reader) {
        const streamingWorksheet = worksheet as StreamingWorksheetReader;
        const sheetMetadata = metadataByName.get(streamingWorksheet.name);
        if (!sheetMetadata) {
          for await (const _row of streamingWorksheet) {
            // Drain unsupported workbook parts without retaining row data.
          }
          continue;
        }
        const snapshotWorkbook = new ExcelJS.Workbook();
        const snapshot = snapshotWorkbook.addWorksheet(sheetMetadata.sheetName);
        const bounds: WorksheetBounds = { rowCount: 0, columnCount: 0, nonEmpty: false };
        const mergeByMaster = this.mergeRangesByMaster(sheetMetadata.mergeRanges);
        for await (const row of streamingWorksheet) {
          this.extendBoundsFromRow(bounds, row, mergeByMaster);
          if (row.number <= STREAMING_HEADER_SNAPSHOT_ROWS) this.copyRowValues(row, snapshot);
        }
        this.applySnapshotMerges(
          snapshot,
          sheetMetadata.mergeRanges,
          STREAMING_HEADER_SNAPSHOT_ROWS,
          Math.min(bounds.columnCount, MAX_COLUMNS)
        );
        observations.set(sheetMetadata.sheetIndex, {
          metadata: sheetMetadata,
          snapshot,
          ...bounds
        });
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Excel 流式解析失败');
    }

    const sheets = metadata.sheets.map((sheet) => {
      const observation = observations.get(sheet.sheetIndex);
      if (!observation) throw new BadRequestException('Excel 工作表元数据与内容不一致');
      return {
        sheetName: sheet.sheetName,
        sheetIndex: sheet.sheetIndex,
        state: sheet.state,
        rowCount: observation.rowCount,
        columnCount: observation.columnCount,
        nonEmpty: observation.nonEmpty,
        mergeCount: sheet.mergeRanges.length,
        formulaCellCount: sheet.formulaCellCount,
        headerCandidates: this.headerCandidates(
          observation.snapshot,
          sheet.mergeRanges,
          observation.rowCount,
          observation.columnCount
        )
      } satisfies WorkbookSheetInspection;
    });
    const nonEmptySheets = sheets.filter((sheet) => sheet.nonEmpty);
    const visibleSheets = nonEmptySheets.filter((sheet) => sheet.state === 'visible');
    const recommendedSheet = visibleSheets.length === 1 ? visibleSheets[0] : undefined;
    const candidate = recommendedSheet?.headerCandidates[0];
    return {
      observations,
      inspection: {
        sheets,
        requiresSheetSelection: nonEmptySheets.length !== 1 || nonEmptySheets[0]?.state !== 'visible',
        processingMode: 'streaming',
        mediaCount: metadata.mediaCount,
        mediaExpandedBytes: metadata.mediaExpandedBytes,
        recommendedSelection: recommendedSheet && candidate ? {
          sheetIndex: recommendedSheet.sheetIndex,
          headerStartRowIndex: candidate.startRowIndex,
          headerRowIndex: candidate.endRowIndex
        } : undefined
      }
    };
  }

  private async parseStreaming(
    buffer: Buffer,
    metadata: XlsxPackageMetadata,
    options: ParseWorkbookOptions
  ): Promise<ParsedWorkbook> {
    const state = await this.inspectStreaming(buffer, metadata);
    const selected = this.selectStreamingSheet(state.inspection.sheets, options);
    const observation = state.observations.get(selected.sheetIndex);
    if (!observation) throw new BadRequestException('Excel 工作表元数据缺失');
    if (selected.state !== 'visible' && !options.allowHiddenSheet) {
      throw new WorkbookSelectionRequiredException('隐藏工作表必须显式确认后才能导入');
    }
    if (selected.columnCount === 0) throw new BadRequestException('Excel 表头不能为空');
    if (selected.columnCount > MAX_COLUMNS) {
      throw new BadRequestException(`Excel 列数不能超过 ${MAX_COLUMNS}`);
    }
    const recommended = selected.headerCandidates[0];
    const headerRowIndex = options.headerRowIndex ?? recommended?.endRowIndex;
    if (!headerRowIndex) throw new WorkbookSelectionRequiredException('请选择有效的表头行');
    const candidateForEnd = selected.headerCandidates.find((candidate) => candidate.endRowIndex === headerRowIndex);
    const headerStartRowIndex = options.headerStartRowIndex ?? candidateForEnd?.startRowIndex ?? headerRowIndex;
    this.validateHeaderRangeValues(headerStartRowIndex, headerRowIndex, selected.rowCount);
    if (selected.rowCount - headerRowIndex > MAX_ROWS) {
      throw new BadRequestException(`Excel 数据行不能超过 ${MAX_ROWS}`);
    }

    let parsed: ParsedWorkbook | undefined;
    try {
      const reader = this.streamingWorkbookReader(buffer, metadata);
      for await (const worksheet of reader) {
        const streamingWorksheet = worksheet as StreamingWorksheetReader;
        if (streamingWorksheet.name === selected.sheetName) {
          parsed = await this.parseSelectedStreamingSheet(
            streamingWorksheet,
            observation,
            headerStartRowIndex,
            headerRowIndex,
            options
          );
        } else {
          for await (const _row of streamingWorksheet) {
            // Drain non-selected sheets while keeping memory bounded.
          }
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Excel 流式解析失败');
    }
    if (!parsed) throw new BadRequestException('Excel 选定工作表无法读取');
    return parsed;
  }

  private async parseSelectedStreamingSheet(
    worksheet: StreamingWorksheetReader,
    observation: StreamingSheetObservation,
    headerStartRowIndex: number,
    headerRowIndex: number,
    options: ParseWorkbookOptions
  ): Promise<ParsedWorkbook> {
    const headerWorkbook = new ExcelJS.Workbook();
    const headerSheet = headerWorkbook.addWorksheet(observation.metadata.sheetName);
    const rows: ParsedImportRow[] = [];
    const seenHashes = new Set<string>();
    const dataMergesByRow = this.indexDataMerges(
      observation.metadata.mergeRanges,
      headerRowIndex + 1,
      observation.rowCount
    );
    let columns: ParsedImportColumn[] | undefined;
    let nextDataRow = headerRowIndex + 1;
    const initializeColumns = () => {
      if (columns) return columns;
      this.applySnapshotMerges(
        headerSheet,
        observation.metadata.mergeRanges,
        headerRowIndex,
        observation.columnCount
      );
      this.validateHeaderFormulaResults(
        headerSheet,
        headerStartRowIndex,
        headerRowIndex,
        observation.columnCount,
        options.allowCachedFormulaResults ?? false
      );
      columns = this.parseHeaders(
        headerSheet,
        headerStartRowIndex,
        headerRowIndex,
        observation.columnCount,
        observation.metadata.mergeRanges
      );
      return columns;
    };

    for await (const row of worksheet) {
      if (row.number <= headerRowIndex) {
        if (row.number >= headerStartRowIndex) this.copyRowValues(row, headerSheet);
        continue;
      }
      if (row.number > observation.rowCount) continue;
      const parsedColumns = initializeColumns();
      while (nextDataRow < row.number) {
          rows.push(this.parseDataRow(
            undefined,
            nextDataRow,
            parsedColumns,
            dataMergesByRow,
            options,
            seenHashes,
            observation.metadata.formulaOverrides
          ));
        nextDataRow += 1;
      }
      rows.push(this.parseDataRow(
        row,
        row.number,
        parsedColumns,
        dataMergesByRow,
        options,
        seenHashes,
        observation.metadata.formulaOverrides
      ));
      nextDataRow = row.number + 1;
    }
    const parsedColumns = initializeColumns();
    while (nextDataRow <= observation.rowCount) {
      rows.push(this.parseDataRow(
        undefined,
        nextDataRow,
        parsedColumns,
        dataMergesByRow,
        options,
        seenHashes,
        observation.metadata.formulaOverrides
      ));
      nextDataRow += 1;
    }
    for (const column of parsedColumns) column.inferredType = this.inferType(column.sampleValues);
    return {
      processingMode: 'streaming',
      sheet: {
        sheetName: observation.metadata.sheetName,
        sheetIndex: observation.metadata.sheetIndex,
        headerRowIndex,
        rowCount: rows.length
      },
      columns: parsedColumns,
      rows
    };
  }

  private streamingWorkbookReader(buffer: Buffer, metadata: XlsxPackageMetadata) {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'cache',
      entries: 'ignore'
    });
    // ExcelJS can visit deferred worksheets before its workbook model is stable.
    (reader as unknown as { model: { sheets: Array<Record<string, unknown>> } }).model = {
      sheets: metadata.sheets.map((sheet) => ({
        id: sheet.workbookSheetId,
        name: sheet.sheetName,
        state: sheet.state,
        rId: sheet.relationshipId
      }))
    };
    return reader;
  }

  private selectStreamingSheet(sheets: WorkbookSheetInspection[], options: ParseWorkbookOptions) {
    const nonEmptySheets = sheets.filter((sheet) => sheet.nonEmpty);
    if (nonEmptySheets.length === 0) throw new BadRequestException('Excel 文件没有可解析的工作表');
    if (options.sheetIndex === undefined) {
      if (nonEmptySheets.length !== 1) {
        throw new WorkbookSelectionRequiredException('工作簿包含多个非空工作表，请选择要导入的工作表');
      }
      return nonEmptySheets[0];
    }
    if (!Number.isInteger(options.sheetIndex) || options.sheetIndex < 0) {
      throw new WorkbookSelectionRequiredException('工作表序号不合法');
    }
    const selected = sheets.find((sheet) => sheet.sheetIndex === options.sheetIndex);
    if (!selected?.nonEmpty) {
      throw new WorkbookSelectionRequiredException('选择的工作表不存在或为空');
    }
    return selected;
  }

  private copyRowValues(source: ExcelJS.Row, target: ExcelJS.Worksheet) {
    const targetRow = target.getRow(source.number);
    source.eachCell({ includeEmpty: false }, (cell, columnIndex) => {
      targetRow.getCell(columnIndex).value = cell.value;
    });
  }

  private worksheetBounds(worksheet: ExcelJS.Worksheet, ranges: CellRange[]): WorksheetBounds {
    const bounds: WorksheetBounds = { rowCount: 0, columnCount: 0, nonEmpty: false };
    const mergeByMaster = this.mergeRangesByMaster(ranges);
    worksheet.eachRow({ includeEmpty: false }, (row) => this.extendBoundsFromRow(bounds, row, mergeByMaster));
    return bounds;
  }

  private extendBoundsFromRow(
    bounds: WorksheetBounds,
    row: ExcelJS.Row,
    mergeByMaster: Map<string, CellRange>
  ) {
    row.eachCell({ includeEmpty: false }, (cell, columnIndex) => {
      if (!this.isBoundaryValue(cell.value)) return;
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const merge = mergeByMaster.get(`${row.number}:${columnIndex}`);
      bounds.nonEmpty = true;
      bounds.rowCount = Math.max(bounds.rowCount, merge?.bottom ?? row.number);
      bounds.columnCount = Math.max(bounds.columnCount, merge?.right ?? columnIndex);
    });
  }

  private mergeRangesByMaster(ranges: CellRange[]) {
    return new Map(ranges.map((range) => [`${range.top}:${range.left}`, range]));
  }

  private isBoundaryValue(value: ExcelJS.CellValue) {
    return value !== null && value !== undefined && value !== '';
  }

  private applySnapshotMerges(
    worksheet: ExcelJS.Worksheet,
    ranges: CellRange[],
    maxRow: number,
    maxColumn: number
  ) {
    for (const range of ranges) {
      if (range.top > maxRow || range.left > maxColumn) continue;
      worksheet.mergeCells(
        range.top,
        range.left,
        Math.min(range.bottom, maxRow),
        Math.min(range.right, maxColumn)
      );
    }
  }

  private inspectSheet(worksheet: ExcelJS.Worksheet, sheetIndex: number): WorkbookSheetInspection {
    const ranges = this.mergeRanges(worksheet);
    const bounds = this.worksheetBounds(worksheet, ranges);
    let formulaCellCount = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
          formulaCellCount += 1;
        }
      });
    });
    return {
      sheetName: worksheet.name,
      sheetIndex,
      state: worksheet.state,
      ...bounds,
      mergeCount: ranges.length,
      formulaCellCount,
      headerCandidates: this.headerCandidates(worksheet, ranges, bounds.rowCount, bounds.columnCount)
    };
  }

  private selectWorksheet(
    workbook: ExcelJS.Workbook,
    nonEmptySheets: WorkbookSheetInspection[],
    options: ParseWorkbookOptions
  ) {
    if (options.sheetIndex === undefined) {
      if (nonEmptySheets.length !== 1) {
        throw new WorkbookSelectionRequiredException('工作簿包含多个非空工作表，请选择要导入的工作表');
      }
      const inspection = nonEmptySheets[0];
      return { worksheet: workbook.worksheets[inspection.sheetIndex], sheetIndex: inspection.sheetIndex, inspection };
    }
    if (!Number.isInteger(options.sheetIndex) || options.sheetIndex < 0) {
      throw new WorkbookSelectionRequiredException('工作表序号不合法');
    }
    const inspection = nonEmptySheets.find((sheet) => sheet.sheetIndex === options.sheetIndex);
    const worksheet = workbook.worksheets[options.sheetIndex];
    if (!worksheet || !inspection) {
      throw new WorkbookSelectionRequiredException('选择的工作表不存在或为空');
    }
    return { worksheet, sheetIndex: options.sheetIndex, inspection };
  }

  private validateHeaderRangeValues(start: number, end: number, rowCount: number) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new WorkbookSelectionRequiredException('表头行范围不合法');
    }
    if (end >= rowCount) {
      throw new WorkbookSelectionRequiredException('表头之后没有可导入的数据行');
    }
    if (end - start > 2) throw new WorkbookSelectionRequiredException('表头范围最多支持连续三行');
  }

  private validateHeaderFormulaResults(
    worksheet: ExcelJS.Worksheet,
    startRowIndex: number,
    endRowIndex: number,
    columnCount: number,
    allowCachedFormulaResults: boolean
  ) {
    const visited = new Set<string>();
    for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const cell = worksheet.getCell(rowIndex, columnIndex);
        const sourceCell = cell.isMerged ? cell.master : cell;
        if (visited.has(sourceCell.address)) continue;
        visited.add(sourceCell.address);
        const normalized = this.normalizeCell(sourceCell);
        if (!normalized.formula) continue;
        if (!allowCachedFormulaResults) {
          throw new WorkbookSelectionRequiredException('表头包含公式，必须显式确认后才能使用缓存结果');
        }
        if (!normalized.formulaResultAvailable || normalized.error) {
          throw new BadRequestException('表头公式缺少可用缓存结果');
        }
      }
    }
  }

  private headerCandidates(
    worksheet: ExcelJS.Worksheet,
    ranges: CellRange[],
    rowCount = worksheet.actualRowCount,
    actualColumnCount = worksheet.actualColumnCount
  ): WorkbookHeaderCandidate[] {
    if (rowCount === 0 || actualColumnCount === 0) return [];
    const lastRow = Math.min(rowCount - 1, MAX_HEADER_SCAN_ROWS);
    const columnCount = Math.min(actualColumnCount, MAX_COLUMNS);
    const candidates = new Map<string, WorkbookHeaderCandidate>();

    for (let end = 1; end <= lastRow; end += 1) {
      this.addHeaderCandidate(candidates, worksheet, ranges, end, end, columnCount, rowCount);
      for (let start = Math.max(1, end - 2); start < end; start += 1) {
        const merged = ranges.some((range) => range.top <= end && range.bottom >= start);
        if (merged) this.addHeaderCandidate(candidates, worksheet, ranges, start, end, columnCount, rowCount);
      }
    }
    return [...candidates.values()]
      .sort((left, right) => right.score - left.score || left.endRowIndex - right.endRowIndex || left.startRowIndex - right.startRowIndex)
      .slice(0, MAX_HEADER_CANDIDATES);
  }

  private addHeaderCandidate(
    target: Map<string, WorkbookHeaderCandidate>,
    worksheet: ExcelJS.Worksheet,
    ranges: CellRange[],
    start: number,
    end: number,
    columnCount: number,
    rowCount: number
  ) {
    const labels = this.headerLabels(worksheet, start, end, columnCount, ranges, false);
    const meaningful = labels.filter((label) => !label.startsWith('未命名列')).length;
    if (meaningful === 0) return;
    const merged = ranges.some((range) => range.top <= end && range.bottom >= start);
    const score = this.headerScore(worksheet, labels, end, meaningful, merged, start !== end, rowCount);
    target.set(`${start}:${end}`, {
      startRowIndex: start,
      endRowIndex: end,
      columnCount,
      labels,
      score,
      merged
    });
  }

  private headerScore(
    worksheet: ExcelJS.Worksheet,
    labels: string[],
    endRow: number,
    meaningful: number,
    merged: boolean,
    multiRow: boolean,
    rowCount: number
  ) {
    const unique = new Set(labels.filter((label) => !label.startsWith('未命名列')).map((label) => this.normalizeHeader(label))).size;
    let followingRows = 0;
    let followingValues = 0;
    for (let rowIndex = endRow + 1; rowIndex <= Math.min(rowCount, endRow + 3); rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      let values = 0;
      for (let columnIndex = 1; columnIndex <= labels.length; columnIndex += 1) {
        if (this.headerCellText(row.getCell(columnIndex))) values += 1;
      }
      if (values > 0) {
        followingRows += 1;
        followingValues += values;
      }
    }
    return meaningful * 10
      + unique * 3
      + followingRows * 4
      + Math.min(followingValues, meaningful * 3)
      + Number(merged && multiRow) * 5
      - endRow * 5;
  }

  private parseHeaders(
    worksheet: ExcelJS.Worksheet,
    startRowIndex: number,
    endRowIndex: number,
    columnCount: number,
    ranges: CellRange[]
  ): ParsedImportColumn[] {
    const sourceNames = this.headerLabels(worksheet, startRowIndex, endRowIndex, columnCount, ranges, true);
    const occurrences = new Map<string, number>();
    const columns: ParsedImportColumn[] = [];

    sourceNames.forEach((sourceName, offset) => {
      const columnIndex = offset + 1;
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
    });

    const duplicateNames = new Set(
      [...occurrences.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    );
    columns.forEach((column) => { column.duplicateName = duplicateNames.has(column.normalizedName); });
    return columns;
  }

  private headerLabels(
    worksheet: ExcelJS.Worksheet,
    startRowIndex: number,
    endRowIndex: number,
    columnCount: number,
    ranges: CellRange[],
    strict: boolean
  ) {
    return Array.from({ length: columnCount }, (_, offset) => {
      const columnIndex = offset + 1;
      const parts: string[] = [];
      for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
        const range = ranges.find((candidate) => (
          rowIndex >= candidate.top && rowIndex <= candidate.bottom
          && columnIndex >= candidate.left && columnIndex <= candidate.right
        ));
        if (range && range.left === 1 && range.right >= columnCount && rowIndex < endRowIndex) continue;
        const cell = worksheet.getRow(rowIndex).getCell(columnIndex);
        const normalized = this.normalizeCell(cell.isMerged ? cell.master : cell);
        if (strict && normalized.error) {
          throw new BadRequestException(`第 ${columnIndex} 列表头不合法`);
        }
        const text = normalized.displayValue === null ? '' : String(normalized.displayValue).trim();
        if (text && parts.at(-1) !== text) parts.push(text);
      }
      return parts.join(' / ') || `未命名列${columnIndex}`;
    });
  }

  private mergeRanges(worksheet: ExcelJS.Worksheet) {
    const values = (worksheet.model as { merges?: string[] }).merges ?? [];
    return values.flatMap((value) => {
      const [start, end = start] = value.split(':');
      const first = this.cellReference(start);
      const last = this.cellReference(end);
      return first && last ? [{
        top: Math.min(first.row, last.row),
        left: Math.min(first.column, last.column),
        bottom: Math.max(first.row, last.row),
        right: Math.max(first.column, last.column)
      }] : [];
    });
  }

  private cellReference(value: string) {
    const match = value.match(/^\$?([A-Z]+)\$?(\d+)$/i);
    if (!match) return undefined;
    let column = 0;
    for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
    return { column, row: Number(match[2]) };
  }

  private indexDataMerges(ranges: CellRange[], firstDataRow: number, lastDataRow: number) {
    const result = new Map<number, CellRange[]>();
    for (const range of ranges) {
      for (let row = Math.max(firstDataRow, range.top); row <= Math.min(lastDataRow, range.bottom); row += 1) {
        result.set(row, [...(result.get(row) ?? []), range]);
      }
    }
    return result;
  }

  private headerCellText(cell: ExcelJS.Cell) {
    const normalized = this.normalizeCell(cell.isMerged ? cell.master : cell);
    return normalized.displayValue === null ? '' : String(normalized.displayValue).trim();
  }

  private normalizeCell(cell: ExcelJS.Cell, formulaOverride?: string): NormalizedCell {
    const value = cell.value;
    if (value === null || value === undefined) return { value: null, displayValue: null, formula: false };
    if (value instanceof Date) {
      const date = this.formatDate(value);
      return { value: date, displayValue: date, formula: false };
    }
    if (typeof value === 'string') return this.normalizeTextCell(value);
    if (typeof value === 'number' || typeof value === 'boolean') {
      return { value, displayValue: value, formula: false };
    }
    if ('formula' in value || 'sharedFormula' in value) {
      const formula = formulaOverride
        ?? cell.formula
        ?? ('formula' in value ? value.formula : value.sharedFormula);
      const formulaText = String(formula ?? '');
      const rawResult = 'result' in value ? value.result : undefined;
      const result = this.jsonSafe(rawResult);
      const invalidResult = rawResult !== null && rawResult !== undefined && result === null;
      return {
        value: { formula: formulaText, result },
        displayValue: result === null ? `[公式] ${formulaText}` : String(result),
        formula: true,
        formulaResultAvailable: result !== null,
        error: !formulaText.trim()
          ? '公式来源不可用'
          : invalidResult
            ? '公式缓存结果不可用'
            : undefined
      };
    }
    if ('richText' in value) return this.normalizeTextCell(value.richText.map((part) => part.text).join(''));
    if ('hyperlink' in value) return this.normalizeTextCell(value.text || value.hyperlink);
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
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    return null;
  }
}
