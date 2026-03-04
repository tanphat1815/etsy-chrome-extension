import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

const args = new Set(process.argv.slice(2));
const SHOULD_OBFUSCATE = args.has('--obfuscate');
const INCLUDE_SAMPLES = args.has('--include-samples');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}
function copyDir(srcDir, destDir, { filter } = {}) {
  if (!fs.existsSync(srcDir)) return;
  mkdirp(destDir);

  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);

    if (filter && !filter(src, ent)) continue;

    if (ent.isDirectory()) copyDir(src, dest, { filter });
    else copyFile(src, dest);
  }
}
function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

async function main() {
  rmrf(DIST);
  mkdirp(DIST);

  // 1) Bundle + minify 2 entry points (giữ nguyên path output)
  await build({
    entryPoints: [
      path.join(ROOT, 'service_worker.js'),
      path.join(ROOT, 'popup', 'index.js'),
    ],
    outdir: DIST,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
  });

  // 2) Copy static files needed at runtime
  copyFile(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  copyFile(path.join(ROOT, 'popup', 'index.html'), path.join(DIST, 'popup', 'index.html'));

  copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));
  copyDir(path.join(ROOT, 'locales'), path.join(DIST, 'locales'));

  // Samples: chỉ copy khi bật flag (tránh leak HTML snapshot khi publish)
  if (INCLUDE_SAMPLES) {
    copyDir(path.join(ROOT, 'samples'), path.join(DIST, 'samples'));
  }

  // 3) Optional: strong obfuscation
  if (SHOULD_OBFUSCATE) {
    const jsFiles = walkFiles(DIST).filter((f) => f.endsWith('.js'));
    for (const file of jsFiles) {
      const code = fs.readFileSync(file, 'utf8');

      const obf = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 1,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.6,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 1,
        numbersToExpressions: true,
        simplify: true,
        renameGlobals: false,
      }).getObfuscatedCode();

      fs.writeFileSync(file, obf, 'utf8');
    }
  }

  console.log(`[build] done -> ${path.relative(ROOT, DIST)}${SHOULD_OBFUSCATE ? ' (obfuscated)' : ''}`);
}

main().catch((e) => {
  console.error('[build] failed:', e);
  process.exit(1);
});