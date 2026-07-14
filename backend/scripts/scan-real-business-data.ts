import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';

import { FileSecurityService } from '../src/files/file-security.service';
import { DocumentPreprocessorService } from '../src/ocr/document-preprocessor.service';
import { scanRealBusinessData, writeRealDataScanArtifacts } from '../src/real-data-test/real-data-scanner';

interface CliOptions {
  input: string;
  output: string;
  report: string;
  uploadLimitMb: number;
  hardUploadLimitMb: number;
  ocrPageLimit: number;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const config = new ConfigService({
    fileScan: {
      mode: 'basic',
      clamavHost: '127.0.0.1',
      clamavPort: 3310,
      timeoutMs: 15_000
    },
    ocr: { maxPdfPages: options.ocrPageLimit }
  });
  const security = new FileSecurityService(config);
  const preprocessor = new DocumentPreprocessorService(config);

  const result = await scanRealBusinessData(options.input, {
    uploadLimitBytes: options.uploadLimitMb * 1024 * 1024,
    hardUploadLimitBytes: options.hardUploadLimitMb * 1024 * 1024,
    ocrPageLimit: options.ocrPageLimit,
    verifyUnchanged: true,
    checks: {
      fileSecurity: (safeFileName, buffer) => security.scan(safeFileName, buffer),
      ocrPreprocessor: async (buffer, mimeType) => {
        await preprocessor.inspect(buffer, mimeType);
      }
    }
  });
  const artifacts = await writeRealDataScanArtifacts(result, options.output, options.report);

  process.stdout.write([
    `B0 scan completed: ${result.aggregate.physicalFiles} physical files`,
    `Original files unchanged: ${result.originalFilesUnchanged ? 'yes' : 'no'}`,
    `Local manifest: ${artifacts.manifestPath}`,
    `Public report: ${artifacts.publicReportPath}`
  ].join('\n') + '\n');
}

function parseOptions(args: string[]): CliOptions {
  const backendRoot = process.cwd();
  const defaults: CliOptions = {
    input: resolve(backendRoot, '..', '数据文件'),
    output: resolve(backendRoot, '..', '.realdata-test'),
    report: resolve(backendRoot, '..', 'docs', 'REAL_BUSINESS_DATA_TEST_REPORT.md'),
    uploadLimitMb: 10,
    hardUploadLimitMb: 50,
    ocrPageLimit: 20
  };
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  const options: CliOptions = {
    input: resolve(values.get('--input') ?? defaults.input),
    output: resolve(values.get('--output') ?? defaults.output),
    report: resolve(values.get('--report') ?? defaults.report),
    uploadLimitMb: readPositiveNumber(values.get('--upload-limit-mb'), defaults.uploadLimitMb, '--upload-limit-mb'),
    hardUploadLimitMb: readPositiveNumber(values.get('--hard-upload-limit-mb'), defaults.hardUploadLimitMb, '--hard-upload-limit-mb'),
    ocrPageLimit: readPositiveNumber(values.get('--ocr-page-limit'), defaults.ocrPageLimit, '--ocr-page-limit')
  };
  if (options.uploadLimitMb > options.hardUploadLimitMb) {
    throw new Error('Default upload limit cannot exceed the hard upload limit');
  }
  return options;
}

function readPositiveNumber(value: string | undefined, fallback: number, name: string) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown real-data scan failure';
  process.stderr.write(`B0 scan failed: ${message}\n`);
  process.exitCode = 1;
});
