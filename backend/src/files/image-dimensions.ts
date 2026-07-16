export interface ImageDimensions {
  width: number;
  height: number;
}

export function pngDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function jpegDimensions(buffer: Buffer): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return undefined;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return undefined;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return undefined;
}

export function webpDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 30 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
    return undefined;
  }
  const kind = buffer.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X' && buffer.length >= 30) {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (kind === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ' && buffer.length >= 30 && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return undefined;
}
