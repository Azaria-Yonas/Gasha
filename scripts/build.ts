import { spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const release = join(root, 'release');
const args = new Set(process.argv.slice(2));

function compile(): void {
  const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const result = spawnSync(bin, ['-p', join(root, 'tsconfig.json')], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) throw new Error('TypeScript found errors. Fix them and build again.');
}

async function copyStatic(): Promise<void> {
  await cp(src, dist, { recursive: true, filter: (path) => !path.endsWith('.ts') });
}

async function syncManifestVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  const manifestPath = join(dist, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.version = pkg.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return pkg.version;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function zip(dir: string, out: string): Promise<void> {
  const files = await listFiles(dir);
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = await readFile(join(dir, file));
    const name = Buffer.from(file.split(sep).join('/'), 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + packed.length;
  }

  const directorySize = directory.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.concat([...parts, ...directory, end]));
}

async function build(): Promise<void> {
  const started = Date.now();
  await rm(dist, { recursive: true, force: true });
  compile();
  await copyStatic();
  const version = await syncManifestVersion();
  console.log(`Built Gasha ${version} into dist/ in ${Date.now() - started} ms`);
  if (args.has('--zip')) {
    const out = join(release, `gasha-${version}.zip`);
    await zip(dist, out);
    console.log(`Packed ${relative(root, out)} for the Chrome Web Store`);
  }
}

await build();

if (args.has('--watch')) {
  let timer: NodeJS.Timeout | undefined;
  console.log('Watching src/ for changes');
  watch(src, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch((error: unknown) => console.error(error instanceof Error ? error.message : error));
    }, 150);
  });
}
