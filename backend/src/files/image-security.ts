const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

export function isStructurallyValidPng(buffer: Buffer) {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  let chunks = 0;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > buffer.length) return false;
    const type = buffer.subarray(typeOffset, dataOffset).toString('ascii');
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = crc32(buffer.subarray(typeOffset, crcOffset));
    if (expectedCrc !== actualCrc) return false;
    chunks += 1;

    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = buffer.readUInt32BE(dataOffset);
      const height = buffer.readUInt32BE(dataOffset + 4);
      if (width === 0 || height === 0) return false;
      sawHeader = true;
    }
    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') return length === 0 && sawHeader && sawImageData && nextOffset === buffer.length;
    offset = nextOffset;
  }
  return false;
}

export function isStructurallyValidJpeg(buffer: Buffer) {
  if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return false;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return false;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) return sawFrame && sawScan && validJpegTrailer(buffer.subarray(offset));
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return false;
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 8) return false;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) return false;
      sawFrame = true;
    }
    if (marker === 0xda) {
      sawScan = true;
      offset += length;
      const eoi = findJpegEndOfImage(buffer, offset);
      if (eoi < 0) return false;
      return sawFrame && validJpegTrailer(buffer.subarray(eoi));
    }
    offset += length;
  }
  return false;
}

function findJpegEndOfImage(buffer: Buffer, start: number) {
  for (let index = start; index + 1 < buffer.length; index += 1) {
    if (buffer[index] !== 0xff) continue;
    const marker = buffer[index + 1];
    if (marker === 0x00 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 1;
      continue;
    }
    if (marker === 0xd9) return index + 2;
  }
  return -1;
}

function validJpegTrailer(trailer: Buffer) {
  if (trailer.length === 0) return true;
  if (startsWithBlockedMagic(trailer)) return false;
  if (trailer.length === 24) return true;
  if (trailer.length <= 1024 && trailer.subarray(0, 5).toString('ascii') === 'vivo{') {
    return trailer.includes(Buffer.from('cameralbum!', 'ascii'));
  }
  return false;
}

function startsWithBlockedMagic(buffer: Buffer) {
  const prefixes = [
    Buffer.from('MZ', 'ascii'),
    Buffer.from('PK\u0003\u0004', 'binary'),
    Buffer.from('%PDF-', 'ascii'),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from('<script', 'ascii')
  ];
  return prefixes.some((prefix) => buffer.subarray(0, prefix.length).equals(prefix));
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
