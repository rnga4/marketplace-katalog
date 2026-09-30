/**
 * Generator foto placeholder untuk unit HP.
 * Membaca src/data/hp.json lalu membuat WebP placeholder per entri `foto`.
 * Output ditulis ke folder `seed-foto/` di akar proyek. Saat container pertama
 * kali jalan, folder ini disalin ke volume data kalau folder foto masih kosong.
 *
 * Placeholder bertanda "FOTO CONTOH" supaya tidak dikira foto asli (R-38).
 * Untuk produksi: hapus seed-foto/ setelah data terisi foto asli via admin.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'seed-foto');
const data = JSON.parse(await readFile(resolve(root, 'src/data/hp.json'), 'utf8'));

const W = 1600;
const H = 2000;

const PALETTES = {
  graphite: { a: '#d9d9d6', b: '#a8a8a3', fg: '#3a3a3a' },
  biru: { a: '#d3e3f2', b: '#8fb3d9', fg: '#1f4e79' },
  abu: { a: '#e0e0df', b: '#b5b5b2', fg: '#4a4a4a' },
  putih: { a: '#f2f0ea', b: '#cbc6bc', fg: '#5a544a' },
  hitam: { a: '#c9c9c9', b: '#7a7a7a', fg: '#1c1c1c' },
  emerald: { a: '#d9eade', b: '#93c9a8', fg: '#2e6b45' },
};

const KATA_KUNCI = [
  [/graphite|grey|gray|hitam|black|silver|perak/i, 'graphite'],
  [/biru|blue/i, 'biru'],
  [/putih|white|cream|ivory/i, 'putih'],
  [/hijau|green|emerald/i, 'emerald'],
  [/abu/i, 'abu'],
];

function paletDariNama(nama) {
  for (const [re, palet] of KATA_KUNCI) {
    if (re.test(nama.toLowerCase())) return palet;
  }
  const hash = [...nama.toLowerCase()].reduce((a, c) => a + c.charCodeAt(0), 0);
  const kunci = Object.keys(PALETTES);
  return kunci[hash % kunci.length];
}

/** Siluet HP (satu angka di layarnya untuk membedakan beberapa foto). */
function svg({ pal, label, nomor }) {
  const palet = PALETTES[pal] ?? PALETTES.graphite;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${palet.a}"/>
  <rect width="${W}" height="${H}" fill="#ffffff" opacity="0.35"/>
  <g transform="translate(${(W - 380) / 2} ${(H - 760) / 2})">
    <rect x="10" y="0" width="360" height="760" rx="48" fill="${palet.fg}" opacity="0.18"/>
    <rect x="0" y="10" width="380" height="740" rx="46" fill="${palet.fg}" opacity="0.9"/>
    <rect x="18" y="30" width="344" height="620" rx="20" fill="${palet.a}"/>
    <rect x="18" y="662" width="344" height="8" rx="4" fill="${palet.fg}" opacity="0.7"/>
    <circle cx="190" cy="686" r="5" fill="none" stroke="${palet.fg}" stroke-width="3" opacity="0.7"/>
    <text x="190" y="420" font-family="Arial, sans-serif" font-size="120" font-weight="bold" fill="${palet.fg}" opacity="0.28" text-anchor="middle">${nomor}</text>
  </g>
  <rect x="0" y="${H - 96}" width="${W}" height="96" fill="#fafaf9" opacity="0.92"/>
  <text x="48" y="${H - 52}" font-family="Arial, sans-serif" font-size="34" fill="#44403c">${label}</text>
  <text x="${W - 48}" y="${H - 52}" font-family="Arial, sans-serif" font-size="26" fill="#78716c" text-anchor="end">FOTO CONTOH</text>
</svg>`;
}

/** Varian lebar harus sama dengan src/lib/foto.ts, kalau tidak thumbnail
 *  di halaman detail akan jatuh ke file yang tidak ada. */
const LEBAR = [
  { akhiran: '', lebar: 1600 },
  { akhiran: '-m', lebar: 1000 },
  { akhiran: '-t', lebar: 400 },
];

/** Nama file besar tetap polos; varian lain pakai akhiran, sama seperti upload. */
function namaVarian(nama, akhiran) {
  const e = extname(nama) || '.webp';
  return akhiran ? `${nama.slice(0, -e.length)}${akhiran}${e}` : nama;
}

async function render(svgBuf, lebar) {
  return sharp(svgBuf, { density: 200 })
    .resize({ width: lebar })
    .webp({ quality: 78, effort: 5 })
    .toBuffer();
}

/**
 * Guard: kalau teks tidak tergambar, setiap foto satu unit keluar identik dan
 * label "FOTO CONTOH" hilang — placeholder jadi tidak bisa dibedakan dari foto
 * asli. librsvg mengabaikan <text> tanpa font, dan itu tidak melempar error,
 * jadi harus dicek sendiri. Lebih baik build berhenti di sini daripada
 * menerbitkan placeholder yang menipu.
 */
async function pastikanTeksTergambar() {
  const pal = PALETTES.graphite;
  const satu = await render(Buffer.from(svg({ pal, label: 'CEK', nomor: 1 })), 400);
  const dua = await render(Buffer.from(svg({ pal, label: 'CEK', nomor: 2 })), 400);
  if (satu.equals(dua)) {
    throw new Error(
      'Teks SVG tidak tergambar, jadi semua foto placeholder akan identik dan tanpa label. ' +
        'Pasang font di tahap build (Dockerfile: fontconfig + dejavu-sans), lalu ulangi.',
    );
  }
}

await pastikanTeksTergambar();

/* Varian lama dibersihkan dulu supaya seed-foto/ tidak menumpuk file usang. */
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let total = 0;
for (const unit of data.hp) {
  const pal = paletDariNama(unit.warna ?? '');
  const daftarFoto = unit.foto?.length ? unit.foto : [`${unit.slug}.webp`];
  for (let i = 0; i < daftarFoto.length; i += 1) {
    const namaFile = daftarFoto[i];
    const svgAsli = Buffer.from(
      svg({ pal, label: `${unit.nama}${unit.kapasitas ? ` · ${unit.kapasitas}` : ''}`, nomor: i + 1 }),
    );
    for (const { akhiran, lebar } of LEBAR) {
      const buf = await render(svgAsli, lebar);
      await writeFile(resolve(outDir, namaVarian(namaFile, akhiran)), buf);
      if (akhiran === '') {
        console.log(`${namaFile}  ${(buf.length / 1024).toFixed(0)} KB  (+${LEBAR.length - 1} varian)`);
      }
      total += 1;
    }
  }
}

console.log(`\n${total} foto placeholder dibuat di seed-foto/`);