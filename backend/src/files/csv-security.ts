export class CsvSecurityError extends Error {}

const MAX_CSV_ROWS = 1_000_000;
const MAX_CSV_COLUMNS = 10_000;
const MAX_CSV_CELL_CHARACTERS = 1_000_000;

export function assertSafeCsv(text: string) {
  if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new CsvSecurityError('CSV contains unsupported control characters');
  }

  let cell = '';
  let quoted = false;
  let justClosedQuote = false;
  let row = 1;
  let column = 1;

  const finishCell = () => {
    assertSafeCsvCell(cell, row, column);
    cell = '';
    justClosedQuote = false;
    column += 1;
    if (column > MAX_CSV_COLUMNS) throw new CsvSecurityError('CSV column limit exceeded');
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        justClosedQuote = true;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0 && !justClosedQuote) {
      quoted = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishCell();
      row += 1;
      column = 1;
      if (row > MAX_CSV_ROWS) throw new CsvSecurityError('CSV row limit exceeded');
    } else {
      if (justClosedQuote && character.trim()) throw new CsvSecurityError('CSV has characters after a closing quote');
      if (!justClosedQuote) cell += character;
    }
    if (cell.length > MAX_CSV_CELL_CHARACTERS) throw new CsvSecurityError('CSV cell size limit exceeded');
  }

  if (quoted) throw new CsvSecurityError('CSV has an unterminated quoted cell');
  if (cell.length > 0 || column > 1 || !/[\r\n]$/.test(text)) assertSafeCsvCell(cell, row, column);
}

function assertSafeCsvCell(value: string, row: number, column: number) {
  const candidate = value.replace(/^[\t ]+/, '');
  if (!candidate) return;
  if (candidate.startsWith('=') || candidate.startsWith('@')) {
    throw new CsvSecurityError(`CSV formula-like cell rejected at row ${row}, column ${column}`);
  }
  if (/^[+-]/.test(candidate) && !/^[+-](?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(candidate)) {
    throw new CsvSecurityError(`CSV formula-like cell rejected at row ${row}, column ${column}`);
  }
}
