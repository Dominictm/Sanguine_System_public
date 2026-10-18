'use strict';
// Zero-dependency ZIP writer/reader — store method only (no compression). Used by the
// character export/import and backup archives; readZip also lets tests round-trip without
// a system unzip tool or an external npm package.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
  const day  = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
  return { time, day };
}

function createZip(files) {
  const { time: dosTime, day: dosDate } = _dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralDirOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// Test-only helper — parses a ZIP produced by createZip() (comment field always empty,
// so the End Of Central Directory record is exactly the last 22 bytes).
function readZip(buf) {
  const eocdOffset = buf.length - 22;
  if (buf.readUInt32LE(eocdOffset) !== 0x06054b50) throw new Error('EOCD not found — не ZIP или повреждён');
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const files = [];
  let ptr = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('central directory record повреждён');
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    files.push({ name, data: Buffer.from(buf.subarray(dataStart, dataStart + compSize)) });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/**
 * Parse ZIP central directory WITHOUT extracting files.
 * Returns array of { name, compressedSize, localHeaderOffset }.
 * Throws on invalid ZIP structure.
 * Used for pre-validation before Expand-Archive (zip-slip protection, size limits).
 */
function parseCentralDirectory(buf) {
  // Find EOCD (End of Central Directory) - last 22 bytes minimum
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  // Search from end backwards (max 64KB comment)
  const searchStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD not found — не ZIP или повреждён');

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
  const centralDirSize = buf.readUInt32LE(eocdOffset + 12);

  if (centralDirOffset + centralDirSize !== eocdOffset) {
    throw new Error('Central directory offset/size mismatch');
  }

  const files = [];
  let ptr = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (ptr + 46 > buf.length) throw new Error('Central directory truncated');
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error('Central directory record повреждён');
    }
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);

    if (ptr + 46 + nameLen + extraLen + commentLen > buf.length) {
      throw new Error('Central directory entry out of bounds');
    }
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen);

    // Security: check for path traversal in archive entry names
    const normalized = path.normalize(name).replace(/\\/g, '/');
    if (normalized.startsWith('../') || normalized.startsWith('..\\') || path.isAbsolute(normalized)) {
      throw new Error(`Path traversal in archive entry: ${name}`);
    }
    // Reject absolute paths and drive letters (Windows)
    if (/^[a-zA-Z]:[\\/]/.test(name) || name.startsWith('/') || name.startsWith('\\')) {
      throw new Error(`Absolute path in archive entry: ${name}`);
    }

    files.push({ name, compressedSize: compSize, uncompressedSize: uncompSize, localHeaderOffset: localOffset });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/**
 * Validate ZIP archive before extraction.
 * Checks: path traversal, total uncompressed size limit, entry count limit.
 * Returns { ok: true, files: [...] } or { ok: false, error: '...' }
 */
function validateZipBeforeExtract(buf, { maxTotalUncompressed = 300 * 1024 * 1024, maxEntries = 10000 } = {}) {
  try {
    const files = parseCentralDirectory(buf);
    if (files.length > maxEntries) {
      return { ok: false, error: `Слишком много файлов в архиве (${files.length} > ${maxEntries})` };
    }
    let totalUncompressed = 0;
    for (const f of files) {
      totalUncompressed += f.uncompressedSize;
      if (totalUncompressed > maxTotalUncompressed) {
        return { ok: false, error: `Архив слишком большой при распаковке (${Math.round(totalUncompressed / 1024 / 1024)} МБ > ${maxTotalUncompressed / 1024 / 1024} МБ)` };
      }
    }
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: 'Не удалось разобрать архив: ' + e.message };
  }
}

const path = require('path');

module.exports = { createZip, readZip, parseCentralDirectory, validateZipBeforeExtract };
