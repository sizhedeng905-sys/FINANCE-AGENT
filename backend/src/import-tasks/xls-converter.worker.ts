import { sanitizeLegacyWorkbookBuffer, XlsConversionPolicyError } from './xls-sanitizer';

const MAX_INPUT_BYTES = 50 * 1024 * 1024;

async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_INPUT_BYTES) throw new XlsConversionPolicyError('XLS 文件大小超出安全转换范围');
    chunks.push(value);
  }

  const converted = sanitizeLegacyWorkbookBuffer(Buffer.concat(chunks, size));
  const metadata = Buffer.from(JSON.stringify(converted.metadata), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(metadata.length);
  await new Promise<void>((resolve, reject) => {
    process.stdout.on('error', reject);
    process.stdout.end(Buffer.concat([header, metadata, converted.buffer]), resolve);
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof XlsConversionPolicyError
    ? error.message
    : 'XLS 文件无法在安全转换器中解析';
  process.stderr.write(JSON.stringify({ code: 'XLS_CONVERSION_FAILED', message }));
  process.exitCode = 1;
});
