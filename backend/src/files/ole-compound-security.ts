const OLE_COMPOUND_FILE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const DIFAT_SECTOR = 0xfffffffc;
const MAX_DIRECTORY_ENTRIES = 512;
const MAX_DIFAT_SECTORS = 1_000;
const ACTIVE_ENTRY = /^(?:_?VBA_PROJECT(?:_CUR)?|PROJECTwm|PROJECT|Macros?|ObjectPool|MBD.*|Ole10Native|Package|CONTENTS|EncryptedPackage|EncryptionInfo|\u0001Ole|\u0001CompObj)$/i;

export interface OleCompoundSummary {
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  directoryEntryCount: number;
  streamNames: string[];
}

export class OleCompoundPolicyError extends Error {}

export function inspectOleCompoundFile(buffer: Buffer): OleCompoundSummary {
  assertPolicy(
    buffer.length >= 512 &&
      buffer.subarray(0, OLE_COMPOUND_FILE_SIGNATURE.length).equals(OLE_COMPOUND_FILE_SIGNATURE),
    'XLS 文件不是有效的 OLE 复合文档'
  );
  const majorVersion = buffer.readUInt16LE(26);
  const byteOrder = buffer.readUInt16LE(28);
  const sectorShift = buffer.readUInt16LE(30);
  const miniSectorShift = buffer.readUInt16LE(32);
  assertPolicy(majorVersion === 3 || majorVersion === 4, 'XLS OLE 主版本不受支持');
  assertPolicy(byteOrder === 0xfffe, 'XLS OLE 字节序不合法');
  assertPolicy(
    (majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12),
    'XLS OLE 扇区大小不合法'
  );
  assertPolicy(miniSectorShift === 6, 'XLS OLE 小扇区大小不合法');
  assertPolicy(buffer.subarray(34, 40).every((value) => value === 0), 'XLS OLE 保留字段不合法');
  assertPolicy(buffer.readUInt32LE(56) === 4096, 'XLS OLE 小流阈值不合法');

  const sectorSize = 2 ** sectorShift as 512 | 4096;
  assertPolicy(buffer.length % sectorSize === 0, 'XLS OLE 文件长度与扇区不一致');
  const sectorCount = buffer.length / sectorSize - 1;
  const fatSectorCount = buffer.readUInt32LE(44);
  assertPolicy(fatSectorCount > 0 && fatSectorCount <= sectorCount, 'XLS OLE FAT 结构不合法');

  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109 && fatSectorIds.length < fatSectorCount; index += 1) {
    const sectorId = buffer.readUInt32LE(76 + index * 4);
    if (sectorId !== FREE_SECTOR) fatSectorIds.push(assertRegularSector(sectorId, sectorCount, 'FAT'));
  }
  collectDifatSectorIds(buffer, sectorSize, sectorCount, fatSectorCount, fatSectorIds);
  assertPolicy(fatSectorIds.length === fatSectorCount, 'XLS OLE DIFAT 条目数量不一致');
  assertPolicy(new Set(fatSectorIds).size === fatSectorIds.length, 'XLS OLE FAT 扇区重复');

  const fat: number[] = [];
  for (const sectorId of fatSectorIds) {
    const offset = sectorOffset(sectorId, sectorSize);
    for (let index = 0; index < sectorSize; index += 4) fat.push(buffer.readUInt32LE(offset + index));
  }

  const firstDirectorySector = assertRegularSector(buffer.readUInt32LE(48), sectorCount, '目录');
  const directorySectors = walkChain(firstDirectorySector, fat, sectorCount, '目录', MAX_DIRECTORY_ENTRIES);
  const streamNames: string[] = [];
  let rootEntries = 0;
  let directoryEntryCount = 0;
  for (const sectorId of directorySectors) {
    const offset = sectorOffset(sectorId, sectorSize);
    for (let entryOffset = 0; entryOffset < sectorSize; entryOffset += 128) {
      const type = buffer[offset + entryOffset + 66];
      if (type === 0) continue;
      assertPolicy([1, 2, 5].includes(type), 'XLS OLE 目录条目类型不合法');
      directoryEntryCount += 1;
      assertPolicy(directoryEntryCount <= MAX_DIRECTORY_ENTRIES, 'XLS OLE 目录条目过多');
      const nameLength = buffer.readUInt16LE(offset + entryOffset + 64);
      assertPolicy(nameLength >= 2 && nameLength <= 64 && nameLength % 2 === 0, 'XLS OLE 目录名称不合法');
      const name = buffer.subarray(offset + entryOffset, offset + entryOffset + nameLength - 2).toString('utf16le');
      assertPolicy(name.length > 0 && !name.includes('\u0000'), 'XLS OLE 目录名称不合法');
      assertPolicy(!ACTIVE_ENTRY.test(name), 'XLS 文件包含宏、嵌入对象或加密内容');
      if (type === 5) rootEntries += 1;
      if (type === 2) streamNames.push(name);
    }
  }
  assertPolicy(rootEntries === 1, 'XLS OLE 根目录结构不合法');
  assertPolicy(streamNames.some((name) => /^(?:Workbook|Book)$/i.test(name)), 'XLS OLE 缺少 Workbook 流');

  return {
    majorVersion,
    sectorSize,
    directoryEntryCount,
    streamNames
  };
}

function collectDifatSectorIds(
  buffer: Buffer,
  sectorSize: number,
  sectorCount: number,
  fatSectorCount: number,
  output: number[]
) {
  const declaredCount = buffer.readUInt32LE(72);
  assertPolicy(declaredCount <= MAX_DIFAT_SECTORS && declaredCount <= sectorCount, 'XLS OLE DIFAT 扇区过多');
  let sectorId = buffer.readUInt32LE(68);
  const visited = new Set<number>();
  for (let position = 0; position < declaredCount; position += 1) {
    sectorId = assertRegularSector(sectorId, sectorCount, 'DIFAT');
    assertPolicy(!visited.has(sectorId), 'XLS OLE DIFAT 链存在循环');
    visited.add(sectorId);
    const offset = sectorOffset(sectorId, sectorSize);
    const entries = sectorSize / 4 - 1;
    for (let index = 0; index < entries && output.length < fatSectorCount; index += 1) {
      const fatSectorId = buffer.readUInt32LE(offset + index * 4);
      if (fatSectorId !== FREE_SECTOR) output.push(assertRegularSector(fatSectorId, sectorCount, 'FAT'));
    }
    sectorId = buffer.readUInt32LE(offset + entries * 4);
  }
  if (declaredCount === 0) {
    assertPolicy(sectorId === END_OF_CHAIN || sectorId === FREE_SECTOR, 'XLS OLE DIFAT 头不合法');
  } else {
    assertPolicy(sectorId === END_OF_CHAIN, 'XLS OLE DIFAT 链长度不一致');
  }
}

function walkChain(
  firstSector: number,
  fat: number[],
  sectorCount: number,
  label: string,
  maxEntries: number
) {
  const output: number[] = [];
  const visited = new Set<number>();
  let sectorId = firstSector;
  const maxSectors = Math.min(sectorCount, Math.ceil(maxEntries * 128 / 512));
  while (sectorId !== END_OF_CHAIN) {
    sectorId = assertRegularSector(sectorId, sectorCount, label);
    assertPolicy(!visited.has(sectorId), `XLS OLE ${label}链存在循环`);
    assertPolicy(output.length < maxSectors, `XLS OLE ${label}链过长`);
    visited.add(sectorId);
    output.push(sectorId);
    const next = fat[sectorId];
    assertPolicy(next !== undefined && next !== FAT_SECTOR && next !== DIFAT_SECTOR && next !== FREE_SECTOR, `XLS OLE ${label}链损坏`);
    sectorId = next;
  }
  return output;
}

function assertRegularSector(sectorId: number, sectorCount: number, label: string) {
  assertPolicy(Number.isInteger(sectorId) && sectorId >= 0 && sectorId < sectorCount, `XLS OLE ${label}扇区不合法`);
  return sectorId;
}

function sectorOffset(sectorId: number, sectorSize: number) {
  return (sectorId + 1) * sectorSize;
}

function assertPolicy(condition: unknown, message: string): asserts condition {
  if (!condition) throw new OleCompoundPolicyError(message);
}
