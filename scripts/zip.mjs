import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'extension.zip');

if (!fs.existsSync(DIST)) {
  console.error('[zip] dist/ not found. Run build first.');
  process.exit(1);
}

if (fs.existsSync(OUT)) fs.rmSync(OUT, { force: true });

const output = fs.createWriteStream(OUT);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`[zip] done -> ${path.relative(ROOT, OUT)} (${archive.pointer()} bytes)`);
});

archive.on('error', (err) => {
  console.error('[zip] failed:', err);
  process.exit(1);
});

archive.pipe(output);
archive.directory(DIST, false); // manifest.json nằm ở root của zip
archive.finalize();
