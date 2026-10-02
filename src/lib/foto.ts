import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

import { FOTO_DIR } from './db';

/**
 * Setiap foto disimpan dalam beberapa lebar supaya halaman tidak pernah
 * menyuruh pembeli mengunduh gambar 4MB hanya untuk melihat thumbnail.
 * Nama file besar tetap seperti yang tersimpan di DB; varian lain memakai
 * akhiran, jadi data lama tidak perlu dimigrasi.
 */
export const LEBAR_BESAR = 1600;
export const LEBAR_SEDANG = 1000;
export const LEBAR_THUMB = 400;

const KUALITAS = 78;

/**
 * Batas ukuran satu file sebelum diproses. Nginx sudah membatasi total body
 * (120m), tapi tanpa batas per file satu unggahan bisa menguras memori server
 * saat sharp mendekode gambar yang sangat besar.
 */
export const MAKS_UKURAN_FOTO = 12 * 1024 * 1024;

type Ukuran = 'thumb' | 'sedang' | 'besar' | 'og';
type Varian = 't' | 'm' | 'og' | null;

const AKHIRAN: Record<Exclude<Ukuran, 'besar' | 'og'>, Varian> = { thumb: 't', sedang: 'm' };

/** Fotografer iPhone sering HEIC, yang tidak bisa sharp decode. */
function kayaknyaHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const jenis = buf.subarray(4, 12).toString('latin1');
  return jenis.startsWith('ftypheic') || jenis.startsWith('ftypheix') || jenis.startsWith('ftypmif1');
}

function namaVarian(nama: string, varian: Varian): string {
  const e = extname(nama);
  const dasar = e ? nama.slice(0, -e.length) : nama;
  return varian ? `${dasar}-${varian}${e || '.webp'}` : nama;
}

function ada(nama: string): boolean {
  return existsSync(join(FOTO_DIR, nama));
}

/**
 * URL foto pada lebar tertentu. Kalau varian kecil belum ada (foto lama,
 * atau seed yang belum diolah), turun ke varian yang lebih besar yang ada,
 * lalu ke file aslinya. Tidak pernah menunjuk file yang tidak ada.
 */
export function fotoSrc(nama: string, ukuran: Ukuran = 'besar'): string {
  const coba: Varian[] =
    ukuran === 'besar' ? [null] : ukuran === 'og' ? ['og', null] : [AKHIRAN[ukuran], 'm', 't', null];
  for (const v of coba) {
    const kandidat = namaVarian(nama, v);
    if (ada(kandidat)) return `/foto/${encodeURIComponent(kandidat)}`;
  }
  return `/foto/${encodeURIComponent(nama)}`;
}

/** Daftar lebar untuk srcset, hanya berisi varian yang benar-benar ada. */
export function fotoSrcSet(nama: string): string | undefined {
  const bagian: string[] = [];
  const pasangan: [Varian, number][] = [
    ['t', LEBAR_THUMB],
    ['m', LEBAR_SEDANG],
    [null, LEBAR_BESAR],
  ];
  for (const [varian, lebar] of pasangan) {
    const kandidat = namaVarian(nama, varian);
    if (ada(kandidat)) bagian.push(`/foto/${encodeURIComponent(kandidat)} ${lebar}w`);
  }
  return bagian.length > 1 ? bagian.join(', ') : undefined;
}

async function olah(asal: Buffer, lebar: number): Promise<Buffer> {
  return sharp(asal, { failOn: 'none' })
    .rotate()
    .resize({ width: lebar, withoutEnlargement: true })
    .webp({ quality: KUALITAS, effort: 4 })
    .toBuffer();
}

/**
 * Simpan satu upload sebagai WebP dalam tiga lebar. Foto diputar dulu
 * mengikuti EXIF, dan foto kecil tidak diperbesar. Mengembalikan nama file
 * besar, satu-satunya nama yang masuk ke DB.
 */
export async function simpanFoto(file: File, slug: string): Promise<string> {
  if (file.size > MAKS_UKURAN_FOTO) {
    throw new Error('Ukuran foto terlalu besar. Maksimal 12 MB per file.');
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar JPG, PNG, atau WebP.');
  }
  const asal = Buffer.from(await file.arrayBuffer());
  if (kayaknyaHeic(asal)) {
    throw new Error(
      'Format HEIC belum bisa diproses. Simpan dulu fotonya sebagai JPG atau PNG, lalu unggah ulang.',
    );
  }

  const acak = randomBytes(4).toString('hex');
  const nama = `${slug}-${Date.now()}-${acak}.webp`;
  try {
    const target: [Varian, number][] = [
      [null, LEBAR_BESAR],
      ['m', LEBAR_SEDANG],
      ['t', LEBAR_THUMB],
    ];
    for (const [varian, lebar] of target) {
      const buf = await olah(asal, lebar);
      writeFileSync(join(FOTO_DIR, namaVarian(nama, varian)), buf);
    }
    const og = await sharp(asal, { failOn: 'none' })
      .rotate()
      .resize(1200, 630, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    writeFileSync(join(FOTO_DIR, namaVarian(nama, 'og')), og);
  } catch {
    throw new Error('Foto tidak bisa diproses. Pastikan file-nya gambar JPG atau PNG yang utuh.');
  }
  return nama;
}

/** Hapus file besar + varian -m/-t. Diam kalau sudah hilang. */
export function hapusFoto(nama: string): void {
  for (const v of [null, 'm', 't', 'og'] as Varian[]) {
    try {
      unlinkSync(join(FOTO_DIR, basename(namaVarian(nama, v))));
    } catch {
      /* sudah hilang */
    }
  }
}
