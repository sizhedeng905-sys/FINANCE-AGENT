import { spawnSync } from 'node:child_process';

import { PDFDocument, StandardFonts } from 'pdf-lib';

const containerName = process.env.PADDLE_CONTAINER_NAME || 'finance-agent-models-paddle-ocr-1';
const endpoint = process.env.PADDLE_OCR_ENDPOINT || 'http://127.0.0.1:8868/ocr';
const inspect = spawnSync('docker', ['inspect', containerName], { encoding: 'utf8', windowsHide: true });
if (inspect.error) throw inspect.error;
if (inspect.status !== 0) throw new Error(`Paddle container is unavailable: ${containerName}`);
const container = JSON.parse(inspect.stdout)[0];
const keyEntry = container?.Config?.Env?.find((entry) => entry.startsWith('API_KEY='));
const apiKey = keyEntry?.slice('API_KEY='.length);
if (!apiKey || apiKey.length < 32) throw new Error('Paddle container API key is unavailable.');

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([320, 480]);
page.drawText('Synthetic OCR acceptance', { x: 24, y: 430, size: 14, font });
page.drawText('amount: 1280.50', { x: 24, y: 400, size: 12, font });
const form = new FormData();
form.set('file', new Blob([await pdf.save()], { type: 'application/pdf' }), 'b8-07-synthetic.pdf');
form.set('documentId', 'b8-07-live-acceptance');
form.set('templateFields', JSON.stringify([{
  fieldId: 'amount',
  fieldKey: 'amount',
  fieldName: 'amount',
  fieldType: 'money',
  semanticType: 'amount',
  aliases: ['total']
}]));

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
  signal: AbortSignal.timeout(300_000)
});
const body = await response.arrayBuffer();
if (body.byteLength > 10 * 1024 * 1024) throw new Error('Paddle OCR response exceeded 10 MiB.');
let payload;
try {
  payload = JSON.parse(Buffer.from(body).toString('utf8'));
} catch {
  throw new Error(`Paddle OCR returned non-JSON content (HTTP ${response.status}).`);
}
if (!response.ok) throw new Error(`Paddle OCR returned HTTP ${response.status}: ${String(payload.detail || 'unknown error').slice(0, 200)}`);
if (
  payload.documentId !== 'b8-07-live-acceptance' ||
  !Array.isArray(payload.pages) ||
  !Array.isArray(payload.fieldCandidates) ||
  typeof payload.extractedText !== 'string'
) {
  throw new Error('Paddle OCR response does not match the provider contract.');
}
console.log(`Live Paddle OCR passed: pages=${payload.pages.length}, candidates=${payload.fieldCandidates.length}, textChars=${payload.extractedText.length}.`);
