import { PDFDocument } from 'pdf-lib';
import { parentPort, workerData } from 'node:worker_threads';

import { hasActivePdfContent } from './pdf-security';

interface PdfWorkerInput {
  buffer: Uint8Array;
}

async function inspectPdf() {
  try {
    const input = workerData as PdfWorkerInput;
    const document = await PDFDocument.load(Buffer.from(input.buffer), {
      ignoreEncryption: false,
      updateMetadata: false
    });
    parentPort?.postMessage({
      ok: true,
      pages: document.getPageCount(),
      objects: document.context.enumerateIndirectObjects().length,
      activeContent: hasActivePdfContent(document)
    });
  } catch {
    parentPort?.postMessage({ ok: false, error: 'PDF cannot be parsed safely or is encrypted' });
  }
}

void inspectPdf();
