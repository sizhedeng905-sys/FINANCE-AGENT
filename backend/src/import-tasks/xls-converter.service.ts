import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FileSecurityService } from '../files/file-security.service';
import { XlsConversionMetadata } from './xls-sanitizer';

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const MINIMUM_NODE_MAJOR = 22;

@Injectable()
export class XlsConverterService {
  private readonly logger = new Logger(XlsConverterService.name);
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(
    config: ConfigService,
    private readonly fileSecurity: FileSecurityService
  ) {
    this.timeoutMs = config.get<number>('xlsConverter.timeoutMs') ?? 30_000;
    this.maxOutputBytes = (config.get<number>('xlsConverter.maxOutputMb') ?? 50) * 1024 * 1024;
  }

  async convert(buffer: Buffer) {
    if (Number.parseInt(process.versions.node.split('.')[0], 10) < MINIMUM_NODE_MAJOR) {
      throw new ServiceUnavailableException(`XLS 安全转换要求 Node.js ${MINIMUM_NODE_MAJOR} 或更高版本`);
    }
    const result = await this.runWorker(buffer);
    await this.fileSecurity.scan('sanitized.xlsx', result.buffer);
    return result;
  }

  private runWorker(buffer: Buffer): Promise<{ buffer: Buffer; metadata: XlsConversionMetadata }> {
    const backendRoot = resolve(__dirname, '..', '..');
    const compiledWorker = join(__dirname, 'xls-converter.worker.js');
    const sourceWorker = join(__dirname, 'xls-converter.worker.ts');
    const useCompiledWorker = existsSync(compiledWorker);
    const worker = useCompiledWorker ? compiledWorker : sourceWorker;
    const args = [
      '--no-warnings',
      '--max-old-space-size=256',
      '--permission',
      `--allow-fs-read=${backendRoot}`,
      '--disable-proto=throw',
      '--unhandled-rejections=strict'
    ];
    if (useCompiledWorker) {
      args.push('--disallow-code-generation-from-strings');
    } else {
      args.push('--require', require.resolve('ts-node/register/transpile-only'));
    }
    args.push(worker);

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, args, {
        cwd: backendRoot,
        env: this.workerEnvironment(backendRoot),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failure: Error | undefined;
      let settled = false;

      const failAndStop = (error: Error) => {
        failure ??= error;
        child.kill();
      };
      const timer = setTimeout(() => {
        failAndStop(new BadRequestException('XLS 安全转换超时'));
      }, this.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.maxOutputBytes + MAX_METADATA_BYTES + 4) {
          failAndStop(new BadRequestException('XLS 转换结果超出大小限制'));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_STDERR_BYTES) {
          failAndStop(new BadRequestException('XLS 安全转换器返回异常信息'));
          return;
        }
        stderr.push(chunk);
      });
      child.stdin.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EPIPE') failAndStop(error);
      });
      child.on('error', (error) => failAndStop(error));
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (failure) {
          rejectPromise(failure);
          return;
        }
        if (code !== 0) {
          const workerError = this.readWorkerError(Buffer.concat(stderr).toString('utf8'));
          if (!workerError.recognized || signal) {
            this.logger.warn(`XLS converter exited unexpectedly with code ${code ?? 'null'} and signal ${signal ?? 'none'}`);
          }
          rejectPromise(new BadRequestException(workerError.message));
          return;
        }
        try {
          resolvePromise(this.decodeOutput(Buffer.concat(stdout, stdoutBytes)));
        } catch (error) {
          rejectPromise(error);
        }
      });
      child.stdin.end(buffer);
    });
  }

  private decodeOutput(output: Buffer) {
    if (output.length < 5) throw new BadRequestException('XLS 安全转换器返回了无效结果');
    const metadataLength = output.readUInt32BE(0);
    if (metadataLength < 2 || metadataLength > MAX_METADATA_BYTES || output.length <= metadataLength + 4) {
      throw new BadRequestException('XLS 安全转换器返回了无效元数据');
    }
    let metadata: unknown;
    try {
      metadata = JSON.parse(output.subarray(4, metadataLength + 4).toString('utf8'));
    } catch {
      throw new BadRequestException('XLS 安全转换器返回了无效元数据');
    }
    if (!this.isMetadata(metadata)) throw new BadRequestException('XLS 安全转换器返回了无效元数据');
    const buffer = output.subarray(metadataLength + 4);
    if (buffer.length > this.maxOutputBytes || !buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) {
      throw new BadRequestException('XLS 安全转换器返回了无效工作簿');
    }
    return { buffer, metadata };
  }

  private isMetadata(value: unknown): value is XlsConversionMetadata {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    const counts = [
      'sheetCount',
      'visibleSheetCount',
      'hiddenSheetCount',
      'veryHiddenSheetCount',
      'cellCount',
      'formulaCellCount',
      'mergeCount',
      'strippedInternalHyperlinkCount'
    ];
    return item.sourceFormat === 'xls' &&
      item.outputFormat === 'xlsx' &&
      item.converter === 'sheetjs-sanitizer' &&
      typeof item.converterVersion === 'string' &&
      item.converterVersion.length > 0 &&
      typeof item.date1904 === 'boolean' &&
      counts.every((key) => Number.isInteger(item[key]) && Number(item[key]) >= 0);
  }

  private readWorkerError(value: string) {
    try {
      const parsed = JSON.parse(value) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.length > 0 && parsed.message.length <= 200) {
        return { message: parsed.message, recognized: true };
      }
    } catch {
      // The parent logs only process metadata; raw converter output may contain parser internals.
    }
    return { message: 'XLS 文件损坏、已加密或超出安全解析范围', recognized: false };
  }

  private workerEnvironment(backendRoot: string): NodeJS.ProcessEnv {
    return {
      NODE_ENV: 'production',
      NODE_NO_WARNINGS: '1',
      TS_NODE_PROJECT: join(backendRoot, 'tsconfig.json'),
      TZ: 'UTC',
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR
    };
  }
}
