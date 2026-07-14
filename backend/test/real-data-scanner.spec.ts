import ExcelJS from 'exceljs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

import {
  assertPublicReportSafe,
  renderPublicReport,
  scanRealBusinessData,
  writeRealDataScanArtifacts
} from '../src/real-data-test/real-data-scanner';

describe('real business data B0 scanner', () => {
  let workspace: string;
  let source: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'finance-realdata-'));
    source = join(workspace, 'source');
    await mkdir(source);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('collects structural metadata and duplicates without reading business values into the public report', async () => {
    const workbook = new ExcelJS.Workbook();
    const detail = workbook.addWorksheet('Private detail');
    detail.addRow(['Private supplier', 'Amount']);
    detail.addRow(['Vendor-Secret-Name', 100]);
    detail.getCell('B2').value = { formula: 'SUM(40,60)', result: 100 };
    detail.mergeCells('A1:B1');
    workbook.addWorksheet('Archive').addRow(['Archived']);
    const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await writeFile(join(source, 'customer-secret.xlsx'), workbookBuffer);
    await writeFile(join(source, 'duplicate-copy.xlsx'), workbookBuffer);
    await writeFile(join(source, 'monthly-package.zip'), workbookBuffer);

    const pdf = await PDFDocument.create();
    for (let page = 0; page < 21; page += 1) pdf.addPage([320, 240]);
    await writeFile(join(source, 'private-receipt.pdf'), Buffer.from(await pdf.save()));
    await writeFile(
      join(source, 'private-image.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    );
    await writeFile(
      join(source, 'legacy-bill.xls'),
      Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)])
    );

    const result = await scanRealBusinessData(source);

    expect(result.originalFilesUnchanged).toBe(true);
    expect(result.aggregate.physicalFiles).toBe(6);
    expect(result.aggregate.duplicateGroups).toBe(1);
    expect(result.aggregate.duplicatePhysicalFiles).toBe(3);
    expect(result.aggregate.xlsx).toMatchObject({
      count: 2,
      totalSheets: 4,
      multiSheetFiles: 2,
      formulaFiles: 2,
      mergedFiles: 2
    });
    expect(result.samples.find((sample) => sample.extension === '.pdf')).toMatchObject({
      route: 'needs-profile',
      pdf: { pages: 21 }
    });
    expect(result.samples.find((sample) => sample.extension === '.xls')).toMatchObject({
      route: 'needs-conversion',
      signatureValid: true
    });
    expect(result.samples.find((sample) => sample.extension === '.png')).toMatchObject({
      image: { width: 1, height: 1, longImage: false }
    });

    const report = renderPublicReport(result);
    expect(report).not.toContain('customer-secret.xlsx');
    expect(report).not.toContain('Vendor-Secret-Name');
    expect(report).not.toContain(result.samples[0].sha256);
    expect(() => assertPublicReportSafe(report, result)).not.toThrow();
    expect(() => assertPublicReportSafe(`${report}\ncustomer-secret.xlsx`, result)).toThrow(
      'Public report contains source-identifying data'
    );

    const output = join(workspace, 'local-output');
    const reportPath = join(workspace, 'public-report.md');
    await writeRealDataScanArtifacts(result, output, reportPath);
    expect(await readFile(join(output, 'inventory.local.json'), 'utf8')).toContain('customer-secret.xlsx');
    expect(await readFile(reportPath, 'utf8')).not.toContain('customer-secret.xlsx');
  });

  it('passes only synthetic names to compatibility checks and records sanitized failures', async () => {
    await writeFile(
      join(source, 'private-image.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    );
    const observedNames: string[] = [];

    const result = await scanRealBusinessData(source, {
      checks: {
        fileSecurity: async (safeName) => {
          observedNames.push(safeName);
          const error = new Error('private detail') as Error & { status: number };
          error.status = 422;
          throw error;
        },
        ocrPreprocessor: async () => undefined
      }
    });

    expect(observedNames).toEqual(['sample.png']);
    expect(result.samples[0].fileSecurity).toEqual({ status: 'rejected', httpStatus: 422, category: 'http_422' });
    expect(JSON.stringify(result.samples[0].fileSecurity)).not.toContain('private detail');
  });

  it('refuses to write local or public artifacts below the read-only source directory', async () => {
    await writeFile(
      join(source, 'private-image.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    );
    const result = await scanRealBusinessData(source);

    await expect(writeRealDataScanArtifacts(
      result,
      join(source, 'forbidden-output'),
      join(workspace, 'report.md')
    )).rejects.toThrow('must be outside the read-only source directory');
    await expect(writeRealDataScanArtifacts(
      result,
      join(workspace, 'output'),
      join(source, 'forbidden-report.md')
    )).rejects.toThrow('must be outside the read-only source directory');
  });

  it('fails closed before expanding an archive beyond the configured structural limits', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sheet').addRow(['value']);
    await writeFile(join(source, 'bounded.zip'), Buffer.from(await workbook.xlsx.writeBuffer()));

    await expect(scanRealBusinessData(source, { archiveEntryLimit: 1 })).rejects.toThrow(
      'Archive exceeds structural entry limit'
    );
    await expect(scanRealBusinessData(source, { archiveExpandedLimitBytes: 1 })).rejects.toThrow(
      'Archive exceeds structural expansion limit'
    );
  });
});
