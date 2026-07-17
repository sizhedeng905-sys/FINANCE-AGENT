import { BadRequestException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as XLSX from 'xlsx';

import { FileSecurityService } from '../src/files/file-security.service';
import { LocalFileStorageService } from '../src/files/local-file-storage.service';
import {
  createSecureUploadOptions,
  resolveQuarantinedUploadPath,
  resolveUploadQuarantineRoot
} from '../src/files/secure-upload-options';

async function minimalOoxml(
  extension: '.xlsx' | '.docx',
  options: { activeField?: boolean; unsafePart?: boolean; activeContentType?: boolean } = {}
) {
  const zip = new JSZip();
  if (extension === '.xlsx') {
    const mainType = options.activeContentType
      ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
    zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/></Types>`);
    zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');
  } else {
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('word/document.xml', options.activeField
      ? '<w:document xmlns:w="urn:test"><w:instrText> DDEAUTO cmd.exe </w:instrText></w:document>'
      : '<w:document xmlns:w="urn:test"><w:body/></w:document>');
  }
  if (options.unsafePart) zip.file('xl/unsafe/payload.bin', 'synthetic-active-part');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function updatePngHeaderCrc(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  buffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
}

describe('FileSecurityService', () => {
  const config = {
    get: jest.fn((key: string) => key === 'fileScan.mode' ? 'basic' : undefined)
  } as unknown as ConfigService;
  const security = new FileSecurityService(config);

  it('accepts parser-valid PDF and OOXML documents', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 240]);
    await expect(security.scan('voucher.pdf', Buffer.from(await pdf.save()))).resolves.toBeUndefined();

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sheet1').addRow(['日期', '金额']);
    await expect(security.scan('records.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()))).resolves.toBeUndefined();

    const legacyWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([['日期', '金额']]), 'Data');
    const legacy = XLSX.write(legacyWorkbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    await expect(security.scan('records.xls', legacy)).resolves.toBeUndefined();
  });

  it('rejects EICAR, forged PDFs, and PDF active content', async () => {
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    await expect(security.scan('eicar.csv', eicar)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(security.scan('forged.pdf', Buffer.from('%PDF-1.4\n%%EOF'))).rejects.toBeInstanceOf(BadRequestException);

    const pdf = await PDFDocument.create();
    pdf.addPage([320, 240]);
    const action = pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    pdf.catalog.set(PDFName.of('OpenAction'), action);
    const active = Buffer.from(await pdf.save());
    await expect(security.scan('active.pdf', active)).rejects.toThrow('PDF contains active content');
  });

  it('accepts active-content words inside a PDF stream instead of treating stream data as PDF actions', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([320, 240]);
    pdf.context.register(pdf.context.stream(Buffer.from('/OpenAction is inert stream data')));
    pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj([page.ref, 'Fit']));

    await expect(security.scan('stream-text.pdf', Buffer.from(await pdf.save()))).resolves.toBeUndefined();
  });

  it('accepts valid PNG and bounded mobile JPEG metadata while rejecting polyglot trailers', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    await expect(security.scan('receipt.png', png)).resolves.toBeUndefined();

    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
      'base64'
    );
    const mobileFooter = Buffer.concat([Buffer.alloc(8, 1), Buffer.alloc(16, 2)]);
    await expect(security.scan('mobile.jpg', Buffer.concat([jpeg, mobileFooter]))).resolves.toBeUndefined();
    await expect(security.scan('polyglot.jpg', Buffer.concat([jpeg, Buffer.from('PK\u0003\u0004payload')]))).rejects
      .toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed OOXML and external relationships', async () => {
    await expect(security.scan('forged.xlsx', Buffer.from('PK\u0003\u0004[Content_Types].xmlxl/workbook.xml')))
      .rejects.toBeInstanceOf(BadRequestException);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('A1').value = { text: '外部链接', hyperlink: 'https://example.invalid/data' };
    await expect(security.scan('external.xlsx', Buffer.from(await workbook.xlsx.writeBuffer())))
      .rejects.toThrow('Office file contains an external relationship');
  });

  it('fails closed for active formulas, field codes, content types, atypical parts, and forged extensions', async () => {
    for (const formula of [
      'WEBSERVICE("https://attacker.invalid")',
      'HYPERLINK("file:///tmp/payload","open")',
      'cmd|\'/C calc\'!A0'
    ]) {
      const activeWorkbook = new ExcelJS.Workbook();
      activeWorkbook.addWorksheet('Data').getCell('A1').value = { formula, result: 'x' };
      await expect(security.scan('active-formula.xlsx', Buffer.from(await activeWorkbook.xlsx.writeBuffer())))
        .rejects.toThrow('active formula');
    }
    await expect(security.scan('active-field.docx', await minimalOoxml('.docx', { activeField: true })))
      .rejects.toThrow('active field code');
    await expect(security.scan('macro-type.xlsx', await minimalOoxml('.xlsx', { activeContentType: true })))
      .rejects.toThrow('active content');
    await expect(security.scan('atypical.xlsx', await minimalOoxml('.xlsx', { unsafePart: true })))
      .rejects.toThrow('atypical or unsafe part');

    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    await expect(security.scan('forged-extension.xlsx', Buffer.from(await pdf.save())))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces an explicit CSV formula policy while retaining plain signed numeric values', async () => {
    for (const value of ['=2+3', '@SUM(A1:A2)', '+cmd|\'/C calc\'!A0', '-cmd|\'/C calc\'!A0']) {
      await expect(security.scan('formula.csv', Buffer.from(`name,value\nsynthetic,"${value}"\n`)))
        .rejects.toThrow('formula-like cell');
    }
    await expect(security.scan('signed.csv', Buffer.from('name,value\ncredit,+12.50\nrefund,-12.50\n')))
      .resolves.toBeUndefined();
  });

  it('rejects decoded-image bombs and PDF page complexity before business processing', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    png.writeUInt32BE(50_000, 16);
    png.writeUInt32BE(50_000, 20);
    updatePngHeaderCrc(png);
    await expect(security.scan('pixel-bomb.png', png)).rejects.toThrow(/width|pixel|memory/);

    const limited = new FileSecurityService({
      get: jest.fn((key: string) => ({ 'fileScan.mode': 'basic', 'fileLimits.pdfMaxPages': 1 })[key])
    } as unknown as ConfigService);
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    pdf.addPage([100, 100]);
    await expect(limited.scan('too-many-pages.pdf', Buffer.from(await pdf.save())))
      .rejects.toThrow('PDF page limit exceeded');
  });

  it('fails closed with a recoverable error when ClamAV is offline', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to reserve an ephemeral TCP port');
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    const clamavConfig = {
      get: jest.fn((key: string) => ({
        'fileScan.mode': 'clamav',
        'fileScan.clamavHost': '127.0.0.1',
        'fileScan.clamavPort': address.port,
        'fileScan.timeoutMs': 250
      })[key])
    } as unknown as ConfigService;
    const clamavSecurity = new FileSecurityService(clamavConfig);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );

    await expect(clamavSecurity.scan('receipt.png', png)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects forged or structurally inconsistent legacy XLS containers', async () => {
    await expect(security.scan('forged.xls', Buffer.alloc(512))).rejects.toBeInstanceOf(BadRequestException);
    const forged = Buffer.alloc(512);
    Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(forged);
    forged.writeUInt16LE(3, 26);
    forged.writeUInt16LE(0xfffe, 28);
    forged.writeUInt16LE(9, 30);
    forged.writeUInt16LE(6, 32);
    forged.writeUInt32LE(4096, 56);
    await expect(security.scan('forged.xls', forged)).rejects.toThrow('FAT');

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[1]]), 'Data');
    const legacy = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    const container = XLSX.CFB.read(legacy, { type: 'buffer' });
    XLSX.CFB.utils.cfb_add(container, 'VBA_PROJECT', Buffer.from('synthetic macro marker'));
    const active = XLSX.CFB.write(container, { type: 'buffer' }) as Buffer;
    await expect(security.scan('active.xls', active)).rejects.toThrow('宏、嵌入对象或加密内容');
  });

  it('only resolves server-generated files inside the quarantine directory', () => {
    const filename = '123e4567-e89b-42d3-a456-426614174000';
    const expected = resolve(process.cwd(), '.upload-quarantine', filename);
    expect(resolveQuarantinedUploadPath({ filename, path: expected })).toBe(expected);
    expect(() => resolveQuarantinedUploadPath({ filename: '../outside', path: expected })).toThrow();
    expect(() => resolveQuarantinedUploadPath({ filename, path: resolve(process.cwd(), filename) })).toThrow();
  });

  it('uses injected upload settings without module-load environment drift', () => {
    const customRoot = resolve(process.cwd(), '.upload-quarantine-test');
    const uploadConfig = {
      get: jest.fn((key: string) => ({
        maxFileSizeMb: 50,
        uploadQuarantineDir: '.upload-quarantine-test'
      })[key])
    } as unknown as ConfigService;
    const options = createSecureUploadOptions(uploadConfig);

    expect(options.limits?.fileSize).toBe(50 * 1024 * 1024 + 1);
    expect(resolveUploadQuarantineRoot(uploadConfig)).toBe(customRoot);
    const filename = '123e4567-e89b-42d3-a456-426614174000';
    const expected = resolve(customRoot, filename);
    expect(resolveQuarantinedUploadPath({ filename, path: expected }, customRoot)).toBe(expected);
  });

  it('stores only validated buffers and confines every local path to a non-symlink root', async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), 'finance-agent-storage-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'finance-agent-outside-'));
    try {
      const outsidePath = join(outsideDir, 'outside.pdf');
      await writeFile(outsidePath, 'untrusted-path-content');
      const storage = new LocalFileStorageService({
        get: jest.fn((key: string) => key === 'uploadDir' ? uploadDir : undefined)
      } as unknown as ConfigService);
      const validated = Buffer.from('validated-buffer-content');
      const key = await storage.save({
        originalname: '../../voucher.pdf',
        path: outsidePath,
        size: validated.length,
        buffer: validated
      } as Express.Multer.File);

      expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
      await expect(storage.read(key)).resolves.toEqual(validated);
      for (const attack of [
        '../outside.pdf',
        '..\\outside.pdf',
        '/etc/passwd',
        'C:\\Windows\\win.ini',
        '\\\\server\\share\\outside.pdf',
        '2026/07/../outside.pdf',
        '2026\\07/123e4567-e89b-42d3-a456-426614174000.pdf',
        '2026/07/%2e%2e%2foutside.pdf',
        '２０２６/07/123e4567-e89b-42d3-a456-426614174000.pdf',
        `2026/07/${'a'.repeat(200)}.pdf`,
        '2026/07/bad\u0000.pdf'
      ]) {
        await expect(storage.read(attack)).rejects.toThrow('非法文件路径');
      }

      const symlinkKey = '2026/07/123e4567-e89b-42d3-a456-426614174000.pdf';
      const symlinkPath = join(uploadDir, ...symlinkKey.split('/'));
      await mkdir(join(uploadDir, '2026', '07'), { recursive: true });
      try {
        await symlink(outsidePath, symlinkPath, 'file');
        await expect(storage.read(symlinkKey)).rejects.toThrow('非法文件路径');
      } catch (error) {
        if (!['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
