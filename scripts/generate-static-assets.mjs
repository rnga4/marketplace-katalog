/**
 * Generator aset statis: og-default.png, favicon.png, apple-touch-icon.png.
 * Output di public/. Jalankan setelah mengganti branding di src/data/site.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public');
await mkdir(outDir, { recursive: true });

const FONT = "font-family='Plus Jakarta Sans, Arial, sans-serif'";

function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fafaf9"/>
  <rect x="0" y="0" width="1200" height="8" fill="#047857"/>
  <text x="80" y="330" ${FONT} font-size="76" font-weight="700" fill="#1c1917">Katalog HP Bekas</text>
  <text x="80" y="404" ${FONT} font-size="34" fill="#57534e">Unit bekas yang kondisinya dipasang apa adanya.</text>
</svg>`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1c1917"/>
  <text x="256" y="320" ${FONT} font-size="180" font-weight="700" fill="#ffffff" text-anchor="middle">HP</text>
</svg>`;
}

async function renderPng(svg, path, size) {
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(path, buf);
  console.log(`${path.split('/').pop()}  ${(buf.length / 1024).toFixed(0)} KB`);
}

await renderPng(ogSvg(), resolve(outDir, 'og-default.png'), 1200);
const favicon = await sharp(Buffer.from(faviconSvg())).resize(512, 512).png().toBuffer();
await writeFile(resolve(outDir, 'favicon.png'), favicon);
await writeFile(resolve(outDir, 'apple-touch-icon.png'), favicon);
console.log('favicon.png / apple-touch-icon.png dibuat');

console.log('\nAset statis siap di public/');