// Packages src/ into dist/TubeToggles-<version>.zip for the Chrome Web Store.
// Dependency-free: writes a standard zip (deflate, forward-slash paths) by hand.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const outFile = join(distDir, `TubeToggles-${manifest.version}.zip`);

// Files that never belong in the store package.
const IGNORED = new Set(['.DS_Store', 'Thumbs.db']);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// DOS date/time fields; a fixed timestamp keeps builds byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of listFiles(srcDir).sort()) {
  const name = Buffer.from(relative(srcDir, file).split(sep).join('/'), 'utf8');
  const data = readFileSync(file);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0x0800, 6);       // flags: UTF-8 names
  local.writeUInt16LE(8, 8);            // method: deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);           // extra length

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);         // version made by
  central.writeUInt16LE(20, 6);         // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);    // local header offset (other fields stay 0)

  localParts.push(local, name, compressed);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}

const centralDir = Buffer.concat(centralParts);
const entries = centralParts.length / 2;

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries, 8);
end.writeUInt16LE(entries, 10);
end.writeUInt32LE(centralDir.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(distDir, { recursive: true });
writeFileSync(outFile, Buffer.concat([...localParts, centralDir, end]));
console.log(`Built ${relative(root, outFile)} (${entries} files)`);
