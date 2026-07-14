import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import * as yauzl from 'yauzl';

import { hasActivePdfContent } from '../files/pdf-security';

const MIB = 1024 * 1024;
const DEFAULT_UPLOAD_LIMIT_BYTES = 10 * MIB;
const HARD_UPLOAD_LIMIT_BYTES = 50 * MIB;
const DEFAULT_OCR_PAGE_LIMIT = 20;
const MAX_COLUMNS = 200;
const MAX_ROWS = 5000;
const MAX_XML_ENTRY_BYTES = 128 * MIB;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 100 * MIB;

export type DataFamily =
  | 'RB-ATT'
  | 'RB-FRT'
  | 'RB-EXP'
  | 'RB-CLM'
  | 'RB-PAY'
  | 'RB-CASH'
  | 'RB-MGT'
  | 'RB-MDM'
  | 'RB-EINV'
  | 'RB-SCAN'
  | 'RB-SHOT'
  | 'RB-TABLE-IMG'
  | 'RB-ARC'
  | 'RB-OTHER';

export type ProcessingRoute =
  | 'supported'
  | 'needs-profile'
  | 'needs-conversion'
  | 'manual-only'
  | 'security-rejected';

export type CompatibilityStatus = 'accepted' | 'rejected' | 'not-applicable' | 'not-checked';

export interface CompatibilityResult {
  status: CompatibilityStatus;
  httpStatus?: number;
  category?: string;
}

export interface XlsxStructure {
  sheetCount: number;
  nonEmptySheetCount: number;
  hiddenSheetCount: number;
  maxRows: number;
  maxColumns: number;
  formulaCells: number;
  mergeCells: number;
  mediaCount: number;
  mediaBytes: number;
  expandedBytes: number;
  hasExternalOrActiveParts: boolean;
}

export interface PdfStructure {
  pages: number;
  encrypted: boolean;
  activeContent: boolean;
}

export interface ImageStructure {
  width: number;
  height: number;
  longImage: boolean;
}

export interface DocxStructure {
  paragraphs: number;
  tables: number;
  tableRows: number;
  mediaCount: number;
  expandedBytes: number;
  hasExternalOrActiveParts: boolean;
}

export interface LocalSampleScan {
  sampleId: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  family: DataFamily;
  route: ProcessingRoute;
  reasons: string[];
  signatureValid: boolean;
  duplicateGroup?: string;
  xlsx?: XlsxStructure;
  pdf?: PdfStructure;
  image?: ImageStructure;
  docx?: DocxStructure;
  fileSecurity: CompatibilityResult;
  ocrPreprocessor: CompatibilityResult;
}

export interface LocalArchiveEntryScan {
  archiveSampleId: string;
  entryId: string;
  entryPath: string;
  extension: string;
  sizeBytes: number;
  compressedBytes: number;
  sha256: string;
  family: DataFamily;
  unsafePath: boolean;
  encrypted: boolean;
  mirrorSampleId?: string;
}

export interface ScanAggregate {
  physicalFiles: number;
  totalBytes: number;
  unchangedFiles: number;
  byExtension: Record<string, { count: number; bytes: number }>;
  byFamily: Record<string, number>;
  byRoute: Record<string, number>;
  byReason: Record<string, number>;
  fileSecurity: Record<string, number>;
  ocrPreprocessor: Record<string, number>;
  duplicateGroups: number;
  duplicatePhysicalFiles: number;
  archives: {
    count: number;
    entries: number;
    mirrorEntries: number;
    unsafeEntries: number;
    encryptedEntries: number;
    uniqueSpreadsheetEntries: number;
  };
  xlsx: {
    count: number;
    totalSheets: number;
    multiSheetFiles: number;
    multiNonEmptySheetFiles: number;
    hiddenSheetFiles: number;
    formulaFiles: number;
    mergedFiles: number;
    mediaFiles: number;
    mediaCount: number;
    mediaBytes: number;
    maxSheets: number;
    maxRows: number;
    maxColumns: number;
    overDefaultUploadLimit: number;
    overHardUploadLimit: number;
    overRowLimit: number;
  };
  pdf: {
    count: number;
    singlePage: number;
    maxPages: number;
    overOcrPageLimit: number;
    encrypted: number;
    activeContent: number;
  };
  images: {
    count: number;
    longImages: number;
    maxWidth: number;
    maxHeight: number;
  };
  docx: {
    count: number;
    tables: number;
    tableRows: number;
  };
}

export interface RealDataScanResult {
  schemaVersion: 1;
  generatedAt: string;
  sourceRoot: string;
  originalFilesUnchanged: boolean;
  samples: LocalSampleScan[];
  archiveEntries: LocalArchiveEntryScan[];
  aggregate: ScanAggregate;
}

export interface ScannerChecks {
  fileSecurity?: (safeFileName: string, buffer: Buffer) => Promise<void>;
  ocrPreprocessor?: (buffer: Buffer, mimeType: string) => Promise<void>;
}

export interface ScanOptions {
  uploadLimitBytes?: number;
  hardUploadLimitBytes?: number;
  ocrPageLimit?: number;
  archiveEntryLimit?: number;
  archiveExpandedLimitBytes?: number;
  verifyUnchanged?: boolean;
  checks?: ScannerChecks;
}

interface OfficePackageStructure {
  xlsx?: XlsxStructure;
  docx?: DocxStructure;
}

interface RawArchiveEntry {
  entryPath: string;
  extension: string;
  sizeBytes: number;
  compressedBytes: number;
  sha256: string;
  family: DataFamily;
  unsafePath: boolean;
  encrypted: boolean;
}

export async function scanRealBusinessData(
  sourceRoot: string,
  options: ScanOptions = {}
): Promise<RealDataScanResult> {
  const root = resolve(sourceRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('Real data source must be a directory');

  const uploadLimitBytes = options.uploadLimitBytes ?? DEFAULT_UPLOAD_LIMIT_BYTES;
  const hardUploadLimitBytes = options.hardUploadLimitBytes ?? HARD_UPLOAD_LIMIT_BYTES;
  const ocrPageLimit = options.ocrPageLimit ?? DEFAULT_OCR_PAGE_LIMIT;
  const archiveEntryLimit = options.archiveEntryLimit ?? MAX_ARCHIVE_ENTRIES;
  const archiveExpandedLimitBytes = options.archiveExpandedLimitBytes ?? MAX_ARCHIVE_EXPANDED_BYTES;
  const paths = await walkFiles(root);
  const samples: LocalSampleScan[] = [];
  const familyCounters = new Map<string, number>();

  for (const absolutePath of paths) {
    const relativePath = toPortablePath(relative(root, absolutePath));
    const extension = extname(relativePath).toLowerCase();
    const fileStat = await stat(absolutePath);
    const family = classifyDataFamily(relativePath, extension);
    const sampleId = nextSampleId(familyCounters, family, extension);
    const sha256 = await hashFile(absolutePath);
    const needsBuffer = Boolean(options.checks?.fileSecurity || options.checks?.ocrPreprocessor)
      || ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(extension);
    const buffer = needsBuffer ? await readFile(absolutePath) : undefined;
    const signatureValid = await validateSignature(absolutePath, extension, buffer);
    let xlsx: XlsxStructure | undefined;
    let pdf: PdfStructure | undefined;
    let image: ImageStructure | undefined;
    let docx: DocxStructure | undefined;

    if (extension === '.xlsx') xlsx = (await inspectOfficePackage(absolutePath, extension)).xlsx;
    if (extension === '.docx') docx = (await inspectOfficePackage(absolutePath, extension)).docx;
    if (extension === '.pdf' && buffer) pdf = await inspectPdf(buffer);
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension) && buffer) {
      image = inspectImage(buffer, extension);
    }

    const fileSecurity = await runCompatibilityCheck(
      options.checks?.fileSecurity,
      buffer,
      `sample${extension}`
    );
    const mimeType = mimeTypeForExtension(extension);
    const ocrPreprocessor = mimeType && isOcrExtension(extension)
      ? await runOcrCheck(options.checks?.ocrPreprocessor, buffer, mimeType)
      : { status: 'not-applicable' as const };
    const decision = decideRoute({
      extension,
      sizeBytes: fileStat.size,
      signatureValid,
      uploadLimitBytes,
      hardUploadLimitBytes,
      ocrPageLimit,
      xlsx,
      pdf,
      fileSecurity,
      ocrPreprocessor
    });

    samples.push({
      sampleId,
      relativePath,
      extension: extension || '[none]',
      sizeBytes: fileStat.size,
      sha256,
      family,
      route: decision.route,
      reasons: decision.reasons,
      signatureValid,
      xlsx,
      pdf,
      image,
      docx,
      fileSecurity,
      ocrPreprocessor
    });
  }

  assignDuplicateGroups(samples);
  const physicalHashes = new Map(samples.map((sample) => [sample.sha256, sample.sampleId]));
  const archiveEntries: LocalArchiveEntryScan[] = [];
  for (const archive of samples.filter((sample) => sample.extension === '.zip')) {
    const entries = await inspectArchive(
      resolve(root, archive.relativePath),
      archiveEntryLimit,
      archiveExpandedLimitBytes
    );
    entries.forEach((entry, index) => {
      archiveEntries.push({
        archiveSampleId: archive.sampleId,
        entryId: `${archive.sampleId}-ENTRY-${String(index + 1).padStart(3, '0')}`,
        ...entry,
        mirrorSampleId: physicalHashes.get(entry.sha256)
      });
    });
  }

  let unchangedFiles = samples.length;
  if (options.verifyUnchanged ?? true) {
    unchangedFiles = 0;
    for (const sample of samples) {
      const currentHash = await hashFile(resolve(root, sample.relativePath));
      if (currentHash !== sample.sha256) throw new Error(`Source file changed during scan: ${sample.sampleId}`);
      unchangedFiles += 1;
    }
  }

  const aggregate = buildAggregate(samples, archiveEntries, unchangedFiles, ocrPageLimit, uploadLimitBytes, hardUploadLimitBytes);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: root,
    originalFilesUnchanged: unchangedFiles === samples.length,
    samples,
    archiveEntries,
    aggregate
  };
}

export async function writeRealDataScanArtifacts(
  result: RealDataScanResult,
  outputDirectory: string,
  publicReportPath: string
) {
  const output = resolve(outputDirectory);
  const report = resolve(publicReportPath);
  assertOutsideSource(result.sourceRoot, output, 'Local output directory');
  assertOutsideSource(result.sourceRoot, report, 'Public report');
  await mkdir(output, { recursive: true, mode: 0o700 });

  const manifestPath = resolve(output, 'inventory.local.json');
  const aggregatePath = resolve(output, 'aggregate.local.json');
  const publicReport = renderPublicReport(result);
  assertPublicReportSafe(publicReport, result);

  await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(aggregatePath, `${JSON.stringify(result.aggregate, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, publicReport, 'utf8');
  return { manifestPath, aggregatePath, publicReportPath: report };
}

export function renderPublicReport(result: RealDataScanResult) {
  const aggregate = result.aggregate;
  const extensionRows = Object.entries(aggregate.byExtension)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([extension, value]) => `| \`${extension}\` | ${value.count} | ${formatMib(value.bytes)} |`)
    .join('\n');
  const familyRows = Object.entries(aggregate.byFamily)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, count]) => `| \`${family}\` | ${count} |`)
    .join('\n');
  const routeRows = Object.entries(aggregate.byRoute)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, count]) => `| \`${route}\` | ${count} |`)
    .join('\n');
  const reasonRows = Object.entries(aggregate.byReason)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `| \`${reason}\` | ${count} |`)
    .join('\n');

  return `# FINANCE-AGENT 真实业务数据 B0 基线报告

> 生成时间：${result.generatedAt}
>
> 本报告只包含匿名聚合指标。原始路径、文件名、完整哈希、业务值和 OCR 原文仅保存在 Git 忽略的本地清单中。

## 门禁结论

| 检查项 | 结果 |
| --- | --- |
| 物理文件已扫描 | ${aggregate.physicalFiles} / ${aggregate.physicalFiles} |
| 原始文件复核哈希未变化 | ${result.originalFilesUnchanged ? '通过' : '失败'}（${aggregate.unchangedFiles} / ${aggregate.physicalFiles}） |
| 文件均有匿名业务分类 | ${sumRecord(aggregate.byFamily) === aggregate.physicalFiles ? '通过' : '失败'} |
| 公开报告包含原始路径/完整哈希 | 否 |
| B0 是否允许进入 B1/B2 | ${result.originalFilesUnchanged ? '允许，按优先级修复兼容问题' : '不允许'} |

## 文件概况

| 格式 | 数量 | 空间 |
| --- | ---: | ---: |
${extensionRows}
| **合计** | **${aggregate.physicalFiles}** | **${formatMib(aggregate.totalBytes)}** |

## 匿名业务分类

| 数据族 | 数量 |
| --- | ---: |
${familyRows}

## 当前处理路线

| 路线 | 数量 |
| --- | ---: |
${routeRows}

| 主要原因 | 数量 |
| --- | ---: |
${reasonRows || '| `none` | 0 |'}

## Excel 结构基线

| 指标 | 结果 |
| --- | ---: |
| XLSX 文件 | ${aggregate.xlsx.count} |
| 工作表总数 | ${aggregate.xlsx.totalSheets} |
| 多工作表文件 | ${aggregate.xlsx.multiSheetFiles} |
| 多个非空工作表文件 | ${aggregate.xlsx.multiNonEmptySheetFiles} |
| 含隐藏工作表文件 | ${aggregate.xlsx.hiddenSheetFiles} |
| 含公式文件 | ${aggregate.xlsx.formulaFiles} |
| 含合并单元格文件 | ${aggregate.xlsx.mergedFiles} |
| 含内嵌媒体文件 | ${aggregate.xlsx.mediaFiles} |
| 内嵌媒体对象 | ${aggregate.xlsx.mediaCount} |
| 内嵌媒体大小 | ${formatMib(aggregate.xlsx.mediaBytes)} |
| 单文件最大工作表数 | ${aggregate.xlsx.maxSheets} |
| 单工作表最大行数 | ${aggregate.xlsx.maxRows} |
| 最大列数 | ${aggregate.xlsx.maxColumns} |
| 超过默认上传限制 | ${aggregate.xlsx.overDefaultUploadLimit} |
| 超过硬上传限制 | ${aggregate.xlsx.overHardUploadLimit} |
| 超过当前行数限制 | ${aggregate.xlsx.overRowLimit} |

## PDF、图片和文档

| 指标 | 结果 |
| --- | ---: |
| PDF 文件 | ${aggregate.pdf.count} |
| 单页 PDF | ${aggregate.pdf.singlePage} |
| 最大页数 | ${aggregate.pdf.maxPages} |
| 超过 OCR 页数限制 | ${aggregate.pdf.overOcrPageLimit} |
| 图片文件 | ${aggregate.images.count} |
| 长图 | ${aggregate.images.longImages} |
| 最大宽度 | ${aggregate.images.maxWidth} |
| 最大高度 | ${aggregate.images.maxHeight} |
| DOCX 文件 | ${aggregate.docx.count} |
| DOCX 表格/表格行 | ${aggregate.docx.tables} / ${aggregate.docx.tableRows} |

## 重复与归档

| 指标 | 结果 |
| --- | ---: |
| 独立文件完全重复组 | ${aggregate.duplicateGroups} |
| 重复组涉及文件 | ${aggregate.duplicatePhysicalFiles} |
| ZIP 文件 | ${aggregate.archives.count} |
| ZIP 条目 | ${aggregate.archives.entries} |
| 与散文件完全相同的条目 | ${aggregate.archives.mirrorEntries} |
| ZIP 内独有表格文件 | ${aggregate.archives.uniqueSpreadsheetEntries} |
| 不安全路径/加密条目 | ${aggregate.archives.unsafeEntries} / ${aggregate.archives.encryptedEntries} |

## 现有服务兼容性

| 检查器 | 接受 | 拒绝 | 不适用/未检查 |
| --- | ---: | ---: | ---: |
| FileSecurityService | ${aggregate.fileSecurity.accepted ?? 0} | ${aggregate.fileSecurity.rejected ?? 0} | ${(aggregate.fileSecurity['not-applicable'] ?? 0) + (aggregate.fileSecurity['not-checked'] ?? 0)} |
| DocumentPreprocessorService | ${aggregate.ocrPreprocessor.accepted ?? 0} | ${aggregate.ocrPreprocessor.rejected ?? 0} | ${(aggregate.ocrPreprocessor['not-applicable'] ?? 0) + (aggregate.ocrPreprocessor['not-checked'] ?? 0)} |

## B0 结论

1. 当前真实数据的首要阻塞仍是多 Sheet/合并表头/公式、旧版 XLS 和大文件，不应通过提高单一大小限制绕过。
2. 表格数据与内嵌凭证必须分层处理，避免一次性载入大量媒体对象。
3. 超过 OCR 页数限制的 PDF 必须显式拆分或选择页范围，不能静默截断。
4. 完全重复当前只做哈希提示与幂等验证，不自动判断业务近似重复。
5. 下一批先补 B1 文件边界测试，再实现 B2 的 Sheet/表头选择和后台分块基线。
`;
}

export function assertPublicReportSafe(report: string, result: RealDataScanResult) {
  const forbidden = new Set<string>();
  for (const sample of result.samples) {
    forbidden.add(sample.relativePath);
    forbidden.add(basename(sample.relativePath));
    forbidden.add(sample.sha256);
  }
  for (const entry of result.archiveEntries) {
    forbidden.add(entry.entryPath);
    forbidden.add(basename(entry.entryPath));
    forbidden.add(entry.sha256);
  }
  for (const candidate of forbidden) {
    if (candidate.length >= 4 && report.includes(candidate)) {
      throw new Error('Public report contains source-identifying data');
    }
  }
  const privacyPatterns = [
    /(?<!\d)1[3-9]\d{9}(?!\d)/,
    /(?<!\d)\d{17}[0-9Xx](?!\d)/,
    /(?<!\d)\d{16,19}(?!\d)/
  ];
  if (privacyPatterns.some((pattern) => pattern.test(report))) {
    throw new Error('Public report contains a sensitive-number pattern');
  }
}

function decideRoute(input: {
  extension: string;
  sizeBytes: number;
  signatureValid: boolean;
  uploadLimitBytes: number;
  hardUploadLimitBytes: number;
  ocrPageLimit: number;
  xlsx?: XlsxStructure;
  pdf?: PdfStructure;
  fileSecurity: CompatibilityResult;
  ocrPreprocessor: CompatibilityResult;
}): { route: ProcessingRoute; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.signatureValid) reasons.push('signature_mismatch');
  if (input.sizeBytes > input.hardUploadLimitBytes) reasons.push('exceeds_hard_upload_limit');
  else if (input.sizeBytes > input.uploadLimitBytes) reasons.push('exceeds_default_upload_limit');

  if (input.extension === '.xls') {
    reasons.push('legacy_xls_requires_conversion');
    return { route: 'needs-conversion', reasons: unique(reasons) };
  }
  if (input.extension === '.zip') {
    reasons.push('archive_requires_safe_unpack');
    return { route: 'needs-conversion', reasons: unique(reasons) };
  }
  if (input.extension === '.docx') {
    reasons.push('document_table_requires_manual_route');
    return { route: input.signatureValid ? 'manual-only' : 'security-rejected', reasons: unique(reasons) };
  }
  if (input.extension === '.xlsx' && input.xlsx) {
    if (input.xlsx.nonEmptySheetCount > 1) reasons.push('multiple_non_empty_sheets');
    if (input.xlsx.hiddenSheetCount > 0) reasons.push('hidden_sheets');
    if (input.xlsx.mergeCells > 0) reasons.push('merged_cells');
    if (input.xlsx.formulaCells > 0) reasons.push('formula_cells');
    if (input.xlsx.maxRows > MAX_ROWS + 1) reasons.push('row_limit');
    if (input.xlsx.maxColumns > MAX_COLUMNS) reasons.push('column_limit');
    if (input.xlsx.mediaCount > 0) reasons.push('embedded_media');
    if (input.xlsx.hasExternalOrActiveParts) reasons.push('active_or_external_office_parts');
    if (input.fileSecurity.status === 'rejected') reasons.push('file_security_rejected');
    if (!input.signatureValid || input.sizeBytes > input.hardUploadLimitBytes || input.fileSecurity.status === 'rejected') {
      return { route: 'security-rejected', reasons: unique(reasons) };
    }
    return { route: reasons.length > 0 ? 'needs-profile' : 'supported', reasons: unique(reasons) };
  }

  if (input.extension === '.pdf' && input.pdf) {
    if (input.pdf.pages > input.ocrPageLimit) reasons.push('ocr_page_limit');
    if (input.pdf.encrypted) reasons.push('encrypted_pdf');
    if (input.pdf.activeContent) reasons.push('active_pdf_content');
    if (input.fileSecurity.status === 'rejected') reasons.push('file_security_rejected');
    if (!input.signatureValid || input.sizeBytes > input.hardUploadLimitBytes || input.fileSecurity.status === 'rejected') {
      return { route: 'security-rejected', reasons: unique(reasons) };
    }
    if (input.ocrPreprocessor.status === 'rejected') reasons.push('ocr_preprocessor_rejected');
    return { route: reasons.length > 0 ? 'needs-profile' : 'supported', reasons: unique(reasons) };
  }

  if (isOcrExtension(input.extension)) {
    if (input.fileSecurity.status === 'rejected') reasons.push('file_security_rejected');
    if (!input.signatureValid || input.sizeBytes > input.hardUploadLimitBytes || input.fileSecurity.status === 'rejected') {
      return { route: 'security-rejected', reasons: unique(reasons) };
    }
    if (input.ocrPreprocessor.status === 'rejected') reasons.push('ocr_preprocessor_rejected');
    return { route: reasons.length > 0 ? 'needs-profile' : 'supported', reasons: unique(reasons) };
  }

  reasons.push('unsupported_file_type');
  return { route: 'manual-only', reasons: unique(reasons) };
}

function buildAggregate(
  samples: LocalSampleScan[],
  archiveEntries: LocalArchiveEntryScan[],
  unchangedFiles: number,
  ocrPageLimit: number,
  uploadLimitBytes: number,
  hardUploadLimitBytes: number
): ScanAggregate {
  const aggregate: ScanAggregate = {
    physicalFiles: samples.length,
    totalBytes: samples.reduce((sum, sample) => sum + sample.sizeBytes, 0),
    unchangedFiles,
    byExtension: {},
    byFamily: {},
    byRoute: {},
    byReason: {},
    fileSecurity: {},
    ocrPreprocessor: {},
    duplicateGroups: new Set(samples.map((sample) => sample.duplicateGroup).filter(Boolean)).size,
    duplicatePhysicalFiles: samples.filter((sample) => sample.duplicateGroup).length,
    archives: {
      count: samples.filter((sample) => sample.extension === '.zip').length,
      entries: archiveEntries.length,
      mirrorEntries: archiveEntries.filter((entry) => entry.mirrorSampleId).length,
      unsafeEntries: archiveEntries.filter((entry) => entry.unsafePath).length,
      encryptedEntries: archiveEntries.filter((entry) => entry.encrypted).length,
      uniqueSpreadsheetEntries: archiveEntries.filter(
        (entry) => !entry.mirrorSampleId && ['.xls', '.xlsx'].includes(entry.extension)
      ).length
    },
    xlsx: {
      count: 0,
      totalSheets: 0,
      multiSheetFiles: 0,
      multiNonEmptySheetFiles: 0,
      hiddenSheetFiles: 0,
      formulaFiles: 0,
      mergedFiles: 0,
      mediaFiles: 0,
      mediaCount: 0,
      mediaBytes: 0,
      maxSheets: 0,
      maxRows: 0,
      maxColumns: 0,
      overDefaultUploadLimit: 0,
      overHardUploadLimit: 0,
      overRowLimit: 0
    },
    pdf: { count: 0, singlePage: 0, maxPages: 0, overOcrPageLimit: 0, encrypted: 0, activeContent: 0 },
    images: { count: 0, longImages: 0, maxWidth: 0, maxHeight: 0 },
    docx: { count: 0, tables: 0, tableRows: 0 }
  };

  for (const sample of samples) {
    incrementCountBytes(aggregate.byExtension, sample.extension, sample.sizeBytes);
    increment(aggregate.byFamily, sample.family);
    increment(aggregate.byRoute, sample.route);
    sample.reasons.forEach((reason) => increment(aggregate.byReason, reason));
    increment(aggregate.fileSecurity, sample.fileSecurity.status);
    increment(aggregate.ocrPreprocessor, sample.ocrPreprocessor.status);

    if (sample.xlsx) {
      const xlsx = sample.xlsx;
      aggregate.xlsx.count += 1;
      aggregate.xlsx.totalSheets += xlsx.sheetCount;
      aggregate.xlsx.multiSheetFiles += Number(xlsx.sheetCount > 1);
      aggregate.xlsx.multiNonEmptySheetFiles += Number(xlsx.nonEmptySheetCount > 1);
      aggregate.xlsx.hiddenSheetFiles += Number(xlsx.hiddenSheetCount > 0);
      aggregate.xlsx.formulaFiles += Number(xlsx.formulaCells > 0);
      aggregate.xlsx.mergedFiles += Number(xlsx.mergeCells > 0);
      aggregate.xlsx.mediaFiles += Number(xlsx.mediaCount > 0);
      aggregate.xlsx.mediaCount += xlsx.mediaCount;
      aggregate.xlsx.mediaBytes += xlsx.mediaBytes;
      aggregate.xlsx.maxSheets = Math.max(aggregate.xlsx.maxSheets, xlsx.sheetCount);
      aggregate.xlsx.maxRows = Math.max(aggregate.xlsx.maxRows, xlsx.maxRows);
      aggregate.xlsx.maxColumns = Math.max(aggregate.xlsx.maxColumns, xlsx.maxColumns);
      aggregate.xlsx.overDefaultUploadLimit += Number(sample.sizeBytes > uploadLimitBytes);
      aggregate.xlsx.overHardUploadLimit += Number(sample.sizeBytes > hardUploadLimitBytes);
      aggregate.xlsx.overRowLimit += Number(xlsx.maxRows > MAX_ROWS + 1);
    }
    if (sample.pdf) {
      aggregate.pdf.count += 1;
      aggregate.pdf.singlePage += Number(sample.pdf.pages === 1);
      aggregate.pdf.maxPages = Math.max(aggregate.pdf.maxPages, sample.pdf.pages);
      aggregate.pdf.overOcrPageLimit += Number(sample.pdf.pages > ocrPageLimit);
      aggregate.pdf.encrypted += Number(sample.pdf.encrypted);
      aggregate.pdf.activeContent += Number(sample.pdf.activeContent);
    }
    if (sample.image) {
      aggregate.images.count += 1;
      aggregate.images.longImages += Number(sample.image.longImage);
      aggregate.images.maxWidth = Math.max(aggregate.images.maxWidth, sample.image.width);
      aggregate.images.maxHeight = Math.max(aggregate.images.maxHeight, sample.image.height);
    }
    if (sample.docx) {
      aggregate.docx.count += 1;
      aggregate.docx.tables += sample.docx.tables;
      aggregate.docx.tableRows += sample.docx.tableRows;
    }
  }
  return aggregate;
}

async function inspectOfficePackage(path: string, extension: '.xlsx' | '.docx'): Promise<OfficePackageStructure> {
  let sheetCount = 0;
  let nonEmptySheetCount = 0;
  let hiddenSheetCount = 0;
  let maxRows = 0;
  let maxColumns = 0;
  let formulaCells = 0;
  let mergeCells = 0;
  let mediaCount = 0;
  let mediaBytes = 0;
  let expandedBytes = 0;
  let hasExternalOrActiveParts = false;
  let paragraphs = 0;
  let tables = 0;
  let tableRows = 0;

  await visitZipEntries(path, async (zip, entry) => {
    expandedBytes += entry.uncompressedSize;
    const entryName = entry.fileName;
    if (/vbaProject|macrosheets|embeddings|externalLinks|oleObject/i.test(entryName)) {
      hasExternalOrActiveParts = true;
    }
    if (extension === '.xlsx' && entryName.startsWith('xl/media/') && !entryName.endsWith('/')) {
      mediaCount += 1;
      mediaBytes += entry.uncompressedSize;
      return;
    }
    if (extension === '.docx' && entryName.startsWith('word/media/') && !entryName.endsWith('/')) {
      mediaCount += 1;
      mediaBytes += entry.uncompressedSize;
      return;
    }
    const shouldRead = extension === '.xlsx'
      ? entryName === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(entryName)
      : entryName === 'word/document.xml';
    if (!shouldRead) return;
    const xml = (await readZipEntry(zip, entry, MAX_XML_ENTRY_BYTES)).toString('utf8');
    if (entryName === 'xl/workbook.xml') {
      sheetCount = matchCount(xml, /<sheet(?:\s|>)/g);
      hiddenSheetCount = matchCount(xml, /<sheet\b[^>]*\bstate=["'](?:hidden|veryHidden)["']/g);
      return;
    }
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(entryName)) {
      const dimensions = inspectWorksheetXml(xml);
      nonEmptySheetCount += Number(dimensions.nonEmpty);
      maxRows = Math.max(maxRows, dimensions.maxRows);
      maxColumns = Math.max(maxColumns, dimensions.maxColumns);
      formulaCells += dimensions.formulaCells;
      mergeCells += dimensions.mergeCells;
      return;
    }
    paragraphs = matchCount(xml, /<w:p(?:\s|>)/g);
    tables = matchCount(xml, /<w:tbl(?:\s|>)/g);
    tableRows = matchCount(xml, /<w:tr(?:\s|>)/g);
  });

  if (extension === '.xlsx') {
    return {
      xlsx: {
        sheetCount,
        nonEmptySheetCount,
        hiddenSheetCount,
        maxRows,
        maxColumns,
        formulaCells,
        mergeCells,
        mediaCount,
        mediaBytes,
        expandedBytes,
        hasExternalOrActiveParts
      }
    };
  }
  return {
    docx: {
      paragraphs,
      tables,
      tableRows,
      mediaCount,
      expandedBytes,
      hasExternalOrActiveParts
    }
  };
}

function inspectWorksheetXml(xml: string) {
  let maxRows = 0;
  let maxColumns = 0;
  const rowPattern = /<row\b[^>]*\br=["'](\d+)["']/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(xml)) !== null) maxRows = Math.max(maxRows, Number(rowMatch[1]));
  const cellPattern = /<c\b[^>]*\br=["']([A-Z]+)(\d+)["']/gi;
  let cellMatch: RegExpExecArray | null;
  let cells = 0;
  while ((cellMatch = cellPattern.exec(xml)) !== null) {
    cells += 1;
    maxColumns = Math.max(maxColumns, columnNumber(cellMatch[1]));
    maxRows = Math.max(maxRows, Number(cellMatch[2]));
  }
  return {
    nonEmpty: cells > 0,
    maxRows,
    maxColumns,
    formulaCells: matchCount(xml, /<f(?:\s|>)/g),
    mergeCells: matchCount(xml, /<mergeCell(?:\s|>)/g)
  };
}

async function inspectPdf(buffer: Buffer): Promise<PdfStructure> {
  const encrypted = buffer.includes(Buffer.from('/Encrypt'));
  try {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
    return { pages: document.getPageCount(), encrypted, activeContent: hasActivePdfContent(document) };
  } catch {
    return { pages: 0, encrypted, activeContent: false };
  }
}

function inspectImage(buffer: Buffer, extension: string): ImageStructure {
  let dimensions: { width: number; height: number } | undefined;
  if (extension === '.png') dimensions = pngDimensions(buffer);
  if (extension === '.jpg' || extension === '.jpeg') dimensions = jpegDimensions(buffer);
  if (extension === '.webp') dimensions = webpDimensions(buffer);
  if (!dimensions) throw new Error(`Unable to read image dimensions for ${extension}`);
  return {
    ...dimensions,
    longImage: Math.max(dimensions.width, dimensions.height) / Math.max(1, Math.min(dimensions.width, dimensions.height)) >= 3
  };
}

async function inspectArchive(
  path: string,
  entryLimit: number,
  expandedLimitBytes: number
): Promise<RawArchiveEntry[]> {
  const entries: RawArchiveEntry[] = [];
  let expandedBytes = 0;
  await visitZipEntries(path, async (zip, entry) => {
    if (entry.fileName.endsWith('/')) return;
    if (entries.length + 1 > entryLimit) throw new Error('Archive exceeds structural entry limit');
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > expandedLimitBytes) throw new Error('Archive exceeds structural expansion limit');
    const stream = await openZipEntry(zip, entry);
    const hash = createHash('sha256');
    await new Promise<void>((resolvePromise, rejectPromise) => {
      stream.on('data', (chunk: Buffer) => hash.update(chunk));
      stream.on('error', rejectPromise);
      stream.on('end', resolvePromise);
    });
    const extension = extname(entry.fileName).toLowerCase() || '[none]';
    entries.push({
      entryPath: entry.fileName,
      extension,
      sizeBytes: entry.uncompressedSize,
      compressedBytes: entry.compressedSize,
      sha256: hash.digest('hex'),
      family: classifyDataFamily(entry.fileName, extension),
      unsafePath: isUnsafeArchivePath(entry.fileName),
      encrypted: (entry.generalPurposeBitFlag & 0x1) !== 0
    });
  });
  return entries.sort((left, right) => left.entryPath.localeCompare(right.entryPath));
}

function classifyDataFamily(relativePath: string, extension: string): DataFamily {
  const value = relativePath.normalize('NFKC').toLowerCase();
  if (extension === '.zip') return 'RB-ARC';
  if (/工资|薪资|薪酬|劳务/.test(value)) return 'RB-PAY';
  if (/理赔|赔付|问题件/.test(value)) return 'RB-CLM';
  if (/考勤|工时|企业结算/.test(value)) return 'RB-ATT';
  if (/报销|核销|备用金|付款申请/.test(value)) return 'RB-EXP';
  if (/现金|资金需求|预算/.test(value)) return 'RB-CASH';
  if (/利润|日报|运营/.test(value)) return 'RB-MGT';
  if (/资产|合同|油车|油耗/.test(value)) return 'RB-MDM';
  if (/司机|运费|账单|帐单|揽收|派送|直收|直派|车辆|电商/.test(value)) return 'RB-FRT';
  if (extension === '.pdf') return /凭证|行程/.test(value) ? 'RB-SCAN' : 'RB-EINV';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    const leaf = basename(value, extension);
    return /^[0-9a-f-]{16,}$/.test(leaf) && !value.includes('/') && !value.includes('\\')
      ? 'RB-TABLE-IMG'
      : 'RB-SHOT';
  }
  return 'RB-OTHER';
}

async function runCompatibilityCheck(
  check: ScannerChecks['fileSecurity'],
  buffer: Buffer | undefined,
  safeFileName: string
): Promise<CompatibilityResult> {
  if (!check) return { status: 'not-checked' };
  if (!buffer) return { status: 'not-checked', category: 'buffer_not_loaded' };
  try {
    await check(safeFileName, buffer);
    return { status: 'accepted' };
  } catch (error) {
    return compatibilityError(error);
  }
}

async function runOcrCheck(
  check: ScannerChecks['ocrPreprocessor'],
  buffer: Buffer | undefined,
  mimeType: string
): Promise<CompatibilityResult> {
  if (!check) return { status: 'not-checked' };
  if (!buffer) return { status: 'not-checked', category: 'buffer_not_loaded' };
  try {
    await check(buffer, mimeType);
    return { status: 'accepted' };
  } catch (error) {
    return compatibilityError(error);
  }
}

function compatibilityError(error: unknown): CompatibilityResult {
  const candidate = error as { getStatus?: () => number; status?: number; name?: string };
  const httpStatus = typeof candidate?.getStatus === 'function' ? candidate.getStatus() : candidate?.status;
  return {
    status: 'rejected',
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : undefined,
    category: Number.isInteger(httpStatus) ? `http_${httpStatus}` : 'runtime_error'
  };
}

async function validateSignature(path: string, extension: string, loaded?: Buffer) {
  const buffer = loaded ?? await readFirstBytes(path, 32);
  if (extension === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (extension === '.webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (extension === '.xls') return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (extension === '.xlsx' || extension === '.docx' || extension === '.zip') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  return true;
}

function pngDimensions(buffer: Buffer) {
  if (buffer.length < 24) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return undefined;
}

function webpDimensions(buffer: Buffer) {
  if (buffer.length < 30) return undefined;
  const kind = buffer.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  return undefined;
}

function columnNumber(letters: string) {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + letter.charCodeAt(0) - 64;
  return value;
}

function assignDuplicateGroups(samples: LocalSampleScan[]) {
  const groups = new Map<string, LocalSampleScan[]>();
  for (const sample of samples) groups.set(sample.sha256, [...(groups.get(sample.sha256) ?? []), sample]);
  const duplicateGroups = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  duplicateGroups.forEach(([, members], index) => {
    const group = `DUP-${String(index + 1).padStart(3, '0')}`;
    members.forEach((member) => { member.duplicateGroup = group; });
  });
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in the real data source');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort((left, right) => toPortablePath(relative(root, left)).localeCompare(toPortablePath(relative(root, right))));
}

async function hashFile(path: string) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.on('data', (chunk: string | Buffer) => { hash.update(chunk); });
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function readFirstBytes(path: string, count: number) {
  const stream = createReadStream(path, { start: 0, end: count - 1 });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.on('data', (chunk: string | Buffer) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return Buffer.concat(chunks);
}

function visitZipEntries(
  path: string,
  visitor: (zip: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>
) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) {
        rejectPromise(openError ?? new Error('Unable to open ZIP container'));
        return;
      }
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) rejectPromise(error);
        else resolvePromise();
      };
      zip.on('error', finish);
      zip.on('end', () => finish());
      zip.on('entry', (entry) => {
        void visitor(zip, entry)
          .then(() => zip.readEntry())
          .catch((error) => {
            zip.close();
            finish(error);
          });
      });
      zip.readEntry();
    });
  });
}

function openZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<NodeJS.ReadableStream>((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) rejectPromise(error ?? new Error('Unable to read ZIP entry'));
      else resolvePromise(stream);
    });
  });
}

async function readZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number) {
  if (entry.uncompressedSize > limit) throw new Error('Office XML entry exceeds structural scan limit');
  const stream = await openZipEntry(zip, entry);
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        (stream as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(new Error('ZIP entry exceeds limit'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return Buffer.concat(chunks);
}

function isUnsafeArchivePath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..');
}

function mimeTypeForExtension(extension: string) {
  const values: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  return values[extension];
}

function isOcrExtension(extension: string) {
  return ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(extension);
}

function nextSampleId(counters: Map<string, number>, family: DataFamily, extension: string) {
  const kind = (extension.replace('.', '') || 'FILE').toUpperCase();
  const key = `${family}-${kind}`;
  const count = (counters.get(key) ?? 0) + 1;
  counters.set(key, count);
  return `${key}-${String(count).padStart(3, '0')}`;
}

function assertOutsideSource(sourceRoot: string, target: string, label: string) {
  const relation = relative(resolve(sourceRoot), resolve(target));
  if (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  ) {
    throw new Error(`${label} must be outside the read-only source directory`);
  }
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function incrementCountBytes(target: Record<string, { count: number; bytes: number }>, key: string, bytes: number) {
  const current = target[key] ?? { count: 0, bytes: 0 };
  target[key] = { count: current.count + 1, bytes: current.bytes + bytes };
}

function sumRecord(record: Record<string, number>) {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function matchCount(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function toPortablePath(value: string) {
  return value.replaceAll('\\', '/');
}

function formatMib(bytes: number) {
  return `${(bytes / MIB).toFixed(2)} MiB`;
}
