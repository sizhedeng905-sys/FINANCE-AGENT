import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export interface PdfInspectionResult {
  pages: number;
  objects: number;
  activeContent: boolean;
}

export function inspectPdfInWorker(buffer: Buffer, timeoutMs: number): Promise<PdfInspectionResult> {
  return new Promise((resolve, reject) => {
    const sourceMode = __filename.endsWith('.ts');
    const workerPath = join(__dirname, `file-inspection.worker.${sourceMode ? 'ts' : 'js'}`);
    const worker = new Worker(workerPath, {
      workerData: { buffer },
      execArgv: sourceMode ? ['--require', require.resolve('ts-node/register/transpile-only')] : [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4
      }
    });
    let settled = false;
    const finish = (error?: Error, result?: PdfInspectionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('PDF inspection timed out')), timeoutMs);
    timer.unref();
    worker.once('message', (message: { ok: boolean; error?: string } & Partial<PdfInspectionResult>) => {
      if (!message.ok) finish(new Error(message.error || 'PDF inspection failed'));
      else finish(undefined, message as PdfInspectionResult);
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`PDF inspection worker exited with code ${code}`));
    });
  });
}
