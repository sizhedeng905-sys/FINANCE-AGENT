import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';

const backendRoot = resolve(import.meta.dirname, '..');
const fixtureDirectory = resolve(backendRoot, 'test-uploads/e2e-fixtures');
const fixturePath = resolve(fixtureDirectory, 'E2E Stage9 标准费用导入.xlsx');
const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).formatToParts(new Date());
const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
const validDate = `${dateValues.year}/${dateValues.month}/${dateValues.day}`;

await mkdir(fixtureDirectory, { recursive: true });

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('费用明细');
sheet.addRow(['发生日期', '费用金额', '车牌', '司机', 'E2E附加费']);
sheet.addRow([validDate, 8765.43, '粤A12345', '王师傅', 300]);
sheet.addRow([validDate, '错误金额', '粤B77889', '刘师傅', 500]);
sheet.addRow(['错误日期', 1200, '粤C10001', '陈师傅', 100]);
sheet.addRow(['']);
sheet.addRow([validDate, 8765.43, '粤A12345', '王师傅', 300]);

await workbook.xlsx.writeFile(fixturePath);
console.log(`Generated E2E Excel fixture: ${fixturePath}`);

const paginationFixturePath = resolve(fixtureDirectory, 'E2E 预览分页费用导入.xlsx');
const paginationWorkbook = new ExcelJS.Workbook();
const paginationSheet = paginationWorkbook.addWorksheet('费用明细');
paginationSheet.addRow(['发生日期', '费用金额']);
for (let index = 1; index <= 25; index += 1) {
  paginationSheet.addRow([validDate, `${index}.01`]);
}
await paginationWorkbook.xlsx.writeFile(paginationFixturePath);
console.log(`Generated E2E pagination Excel fixture: ${paginationFixturePath}`);

const formulaFixturePath = resolve(fixtureDirectory, 'E2E 公式缓存费用导入.xlsx');
const formulaWorkbook = new ExcelJS.Workbook();
const formulaSheet = formulaWorkbook.addWorksheet('费用明细');
formulaSheet.addRow(['发生日期', '费用金额', '车牌', '司机']);
const formulaDataRow = formulaSheet.addRow([validDate, null, '粤A54321', '公式测试司机']);
formulaDataRow.getCell(2).value = { formula: 'SUM(8000,765.43)', result: 8765.43 };
const formulaImageId = formulaWorkbook.addImage({
  extension: 'png',
  base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
});
formulaSheet.addImage(formulaImageId, { tl: { col: 5, row: 0 }, ext: { width: 1, height: 1 } });
await formulaWorkbook.xlsx.writeFile(formulaFixturePath);
console.log(`Generated E2E formula Excel fixture: ${formulaFixturePath}`);

const aiReviewFixturePath = resolve(fixtureDirectory, 'E2E AI审核证据费用导入.xlsx');
const aiReviewWorkbook = new ExcelJS.Workbook();
const aiReviewSheet = aiReviewWorkbook.addWorksheet('AI审核证据');
aiReviewSheet.addRow(['发生日期', '费用金额', '车牌', '司机']);
const aiReviewDataRow = aiReviewSheet.addRow([validDate, null, '粤A65432', 'AI审核测试司机']);
aiReviewDataRow.getCell(2).value = { formula: 'SUM(8000,765.43)', result: 8765.43 };
await aiReviewWorkbook.xlsx.writeFile(aiReviewFixturePath);
console.log(`Generated E2E AI review evidence fixture: ${aiReviewFixturePath}`);

const demoFixturePath = resolve(fixtureDirectory, 'E2E 周五演示费用导入.xlsx');
const demoWorkbook = new ExcelJS.Workbook();
const demoSheet = demoWorkbook.addWorksheet('周五演示费用明细');
demoSheet.addRow(['发生日期', '费用金额', '车牌', '司机']);
demoSheet.addRow([validDate, 1250.25, '演A10001', '演示司机甲']);
const demoFormulaRow = demoSheet.addRow([validDate, null, '演A10002', '演示司机乙']);
demoFormulaRow.getCell(2).value = { formula: 'SUM(8000,765.43)', result: 8765.43 };
demoSheet.addRow([validDate, 3406.53, '演A10003', '演示司机丙']);
await demoWorkbook.xlsx.writeFile(demoFixturePath);
console.log(`Generated Friday demo Excel fixture: ${demoFixturePath}`);

const legacyFixturePath = resolve(fixtureDirectory, 'E2E 旧版费用导入.xls');
const legacyWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([
  ['发生日期', '费用金额', '车牌', '司机'],
  [validDate, 4321.09, '粤A24680', '旧版测试司机']
]), '费用明细');
await writeFile(legacyFixturePath, XLSX.write(legacyWorkbook, { type: 'buffer', bookType: 'biff8' }));
console.log(`Generated E2E legacy Excel fixture: ${legacyFixturePath}`);

const ocrFixturePath = resolve(fixtureDirectory, 'E2E OCR 标准票据.pdf');
const pdf = await PDFDocument.create();
const page = pdf.addPage([420, 595]);
page.drawText('E2E Synthetic Receipt', { x: 40, y: 535, size: 18, color: rgb(0.1, 0.1, 0.1) });
page.drawText(`Date: ${validDate}`, { x: 40, y: 495, size: 12 });
page.drawText('Amount: 1280.50', { x: 40, y: 468, size: 12 });
page.drawText('Payee: Temporary Warehouse', { x: 40, y: 441, size: 12 });
await writeFile(ocrFixturePath, await pdf.save());
console.log(`Generated E2E OCR fixture: ${ocrFixturePath}`);
