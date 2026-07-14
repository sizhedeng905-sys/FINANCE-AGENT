import { BadRequestException } from '@nestjs/common';
import { slideFormula } from 'exceljs/lib/utils/shared-formula';
import { posix } from 'node:path';
import { SaxesParser } from 'saxes';
import * as yauzl from 'yauzl';

const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;

export interface XlsxCellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface XlsxArchiveSummary {
  entryCount: number;
  expandedBytes: number;
  mediaCount: number;
  mediaExpandedBytes: number;
}

export interface XlsxPackageSheet {
  sheetName: string;
  sheetIndex: number;
  workbookSheetId: number;
  relationshipId: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  xmlPath: string;
  mergeRanges: XlsxCellRange[];
  formulaCellCount: number;
  formulaOverrides: ReadonlyMap<string, string>;
}

export interface XlsxPackageMetadata extends XlsxArchiveSummary {
  sheets: XlsxPackageSheet[];
}

interface WorkbookSheetReference {
  name: string;
  sheetId: number;
  state: XlsxPackageSheet['state'];
  relationshipId: string;
}

interface WorksheetXmlMetadata {
  mergeRanges: XlsxCellRange[];
  formulaCellCount: number;
  formulaOverrides: ReadonlyMap<string, string>;
}

interface SharedFormulaCell {
  address: string;
  sharedIndex: string;
  reference?: string;
  formula: string;
}

type XmlTag = {
  name: string;
  attributes: Record<string, string | { value: string }>;
};

export async function readXlsxArchiveSummary(buffer: Buffer): Promise<XlsxArchiveSummary> {
  return walkArchive(buffer, false);
}

export async function readXlsxPackageMetadata(buffer: Buffer): Promise<XlsxPackageMetadata> {
  const result = await walkArchive(buffer, true);
  if (!('sheets' in result)) throw new BadRequestException('Excel 工作簿元数据缺失');
  return result;
}

function walkArchive(buffer: Buffer, includeXml: false): Promise<XlsxArchiveSummary>;
function walkArchive(buffer: Buffer, includeXml: true): Promise<XlsxPackageMetadata>;
function walkArchive(buffer: Buffer, includeXml: boolean): Promise<XlsxArchiveSummary | XlsxPackageMetadata> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(new BadRequestException('Excel 文件内容损坏或不是有效的 .xlsx 文件'));
        return;
      }

      let settled = false;
      let entryCount = 0;
      let expandedBytes = 0;
      let mediaCount = 0;
      let mediaExpandedBytes = 0;
      let workbookSheets: WorkbookSheetReference[] = [];
      const relationships = new Map<string, string>();
      const worksheetMetadata = new Map<string, WorksheetXmlMetadata>();

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        if (error) {
          reject(error instanceof BadRequestException
            ? error
            : new BadRequestException('Excel 工作簿元数据解析失败'));
          return;
        }
        const summary: XlsxArchiveSummary = {
          entryCount,
          expandedBytes,
          mediaCount,
          mediaExpandedBytes
        };
        if (!includeXml) {
          resolve(summary);
          return;
        }
        const sheets = workbookSheets.flatMap((sheet) => {
          const xmlPath = relationships.get(sheet.relationshipId);
          if (!xmlPath) return [];
          const metadata = worksheetMetadata.get(xmlPath);
          if (!metadata) return [];
          return [{
            sheetName: sheet.name,
            sheetIndex: 0,
            workbookSheetId: sheet.sheetId,
            relationshipId: sheet.relationshipId,
            state: sheet.state,
            xmlPath,
            mergeRanges: metadata.mergeRanges,
            formulaCellCount: metadata.formulaCellCount,
            formulaOverrides: metadata.formulaOverrides
          }];
        }).map((sheet, sheetIndex) => ({ ...sheet, sheetIndex }));
        if (sheets.length === 0 || sheets.length !== workbookSheets.length) {
          reject(new BadRequestException(
            sheets.length === 0 ? 'Excel 文件没有可解析的工作表' : 'Excel 工作表关系元数据不完整'
          ));
          return;
        }
        if (new Set(sheets.map((sheet) => sheet.xmlPath)).size !== sheets.length) {
          reject(new BadRequestException('Excel 工作表关系元数据冲突'));
          return;
        }
        resolve({ ...summary, sheets });
      };

      zip.on('error', finish);
      zip.on('end', () => finish());
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        try {
          entryCount += 1;
          expandedBytes += entry.uncompressedSize;
          assertArchiveBoundary(entryCount <= MAX_ARCHIVE_ENTRIES, 'Excel 压缩包条目过多');
          assertArchiveBoundary(expandedBytes <= MAX_ARCHIVE_EXPANDED_BYTES, 'Excel 文件展开后过大');
          if (entry.fileName.startsWith('xl/media/') && !entry.fileName.endsWith('/')) {
            mediaCount += 1;
            mediaExpandedBytes += entry.uncompressedSize;
          }
          if (!includeXml || !isMetadataXml(entry.fileName)) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              finish(new BadRequestException('Excel XML 条目读取失败'));
              return;
            }
            const parser = new SaxesParser({ xmlns: false });
            const mergeRanges: XlsxCellRange[] = [];
            const sharedFormulaCells: SharedFormulaCell[] = [];
            let formulaCellCount = 0;
            let currentCellAddress: string | undefined;
            let currentFormula: SharedFormulaCell | undefined;
            let parserError: unknown;
            parser.on('error', (error) => { parserError = error; });
            parser.on('opentag', (tag) => {
              const node = tag as unknown as XmlTag;
              if (entry.fileName === 'xl/workbook.xml' && node.name === 'sheet') {
                const name = attribute(node, 'name');
                const relationshipId = attribute(node, 'r:id');
                const sheetId = Number(attribute(node, 'sheetId'));
                if (name && relationshipId && Number.isInteger(sheetId) && sheetId > 0) {
                  const state = attribute(node, 'state');
                  workbookSheets.push({
                    name,
                    sheetId,
                    relationshipId,
                    state: state === 'hidden' || state === 'veryHidden' ? state : 'visible'
                  });
                }
                return;
              }
              if (entry.fileName === 'xl/_rels/workbook.xml.rels' && node.name === 'Relationship') {
                const id = attribute(node, 'Id');
                const target = attribute(node, 'Target');
                const type = attribute(node, 'Type');
                if (id && target && type?.endsWith('/worksheet')) {
                  relationships.set(id, normalizeWorkbookTarget(target));
                }
                return;
              }
              if (!isWorksheetXml(entry.fileName)) return;
              if (node.name === 'c') {
                currentCellAddress = attribute(node, 'r');
              } else if (node.name === 'mergeCell') {
                const range = parseCellRange(attribute(node, 'ref'));
                if (range) mergeRanges.push(range);
              } else if (node.name === 'f') {
                formulaCellCount += 1;
                const sharedIndex = attribute(node, 'si');
                if (attribute(node, 't') === 'shared' && sharedIndex !== undefined && currentCellAddress) {
                  currentFormula = {
                    address: currentCellAddress,
                    sharedIndex,
                    reference: attribute(node, 'ref'),
                    formula: ''
                  };
                }
              }
            });
            parser.on('text', (value) => {
              if (currentFormula) currentFormula.formula += value;
            });
            parser.on('closetag', (tag) => {
              const name = (tag as unknown as { name: string }).name;
              if (name === 'f' && currentFormula) {
                sharedFormulaCells.push(currentFormula);
                currentFormula = undefined;
              } else if (name === 'c') {
                currentCellAddress = undefined;
              }
            });
            stream.on('data', (chunk: Buffer) => {
              if (parserError) return;
              try {
                parser.write(chunk.toString('utf8'));
              } catch (error) {
                parserError = error;
                stream.destroy(error instanceof Error ? error : new Error('Invalid worksheet XML'));
              }
            });
            stream.on('error', (error) => finish(parserError ?? error));
            stream.on('end', () => {
              if (settled) return;
              try {
                parser.close();
                if (parserError) throw parserError;
                if (isWorksheetXml(entry.fileName)) {
                  worksheetMetadata.set(entry.fileName, {
                    mergeRanges,
                    formulaCellCount,
                    formulaOverrides: resolveSharedFormulaOverrides(sharedFormulaCells)
                  });
                }
                zip.readEntry();
              } catch (error) {
                finish(error);
              }
            });
          });
        } catch (error) {
          finish(error);
        }
      });
      zip.readEntry();
    });
  });
}

function resolveSharedFormulaOverrides(cells: SharedFormulaCell[]) {
  const masters = new Map<string, SharedFormulaCell>();
  for (const cell of cells) {
    if (!cell.reference && !cell.formula) continue;
    const existing = masters.get(cell.sharedIndex);
    if (existing && existing.address !== cell.address) {
      throw new BadRequestException('Excel 共享公式元数据冲突');
    }
    masters.set(cell.sharedIndex, cell);
  }
  const formulas = new Map<string, string>();
  for (const cell of cells) {
    const master = masters.get(cell.sharedIndex);
    if (!master?.formula) throw new BadRequestException('Excel 共享公式元数据不完整');
    formulas.set(
      cell.address,
      cell.address === master.address
        ? master.formula
        : slideFormula(master.formula, master.address, cell.address)
    );
  }
  return formulas;
}

function isMetadataXml(fileName: string) {
  return fileName === 'xl/workbook.xml'
    || fileName === 'xl/_rels/workbook.xml.rels'
    || isWorksheetXml(fileName);
}

function isWorksheetXml(fileName: string) {
  return /^xl\/worksheets\/[^/]+\.xml$/i.test(fileName);
}

function normalizeWorkbookTarget(target: string) {
  const normalized = target.replace(/\\/g, '/');
  const joined = normalized.startsWith('/')
    ? posix.normalize(normalized.slice(1))
    : posix.normalize(posix.join('xl', normalized));
  if (!joined.startsWith('xl/worksheets/') || joined.includes('../')) {
    throw new BadRequestException('Excel 工作表关系路径不合法');
  }
  return joined;
}

function attribute(tag: XmlTag, name: string) {
  const value = tag.attributes[name];
  return typeof value === 'string' ? value : value?.value;
}

function parseCellRange(value?: string): XlsxCellRange | undefined {
  if (!value) return undefined;
  const [start, end = start] = value.split(':');
  const first = parseCellReference(start);
  const last = parseCellReference(end);
  if (!first || !last) return undefined;
  return {
    top: Math.min(first.row, last.row),
    left: Math.min(first.column, last.column),
    bottom: Math.max(first.row, last.row),
    right: Math.max(first.column, last.column)
  };
}

function parseCellReference(value: string) {
  const match = value.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!match) return undefined;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function assertArchiveBoundary(condition: boolean, message: string): asserts condition {
  if (!condition) throw new BadRequestException(message);
}
