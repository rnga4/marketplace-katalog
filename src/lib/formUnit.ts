import { teksForm, daftarForm, checkboxOn, angkaForm, angkaAtauNull } from './forms';
import { simpanFoto } from './foto';
import { slugify, type Kondisi, type UnitInput } from './db';

/** Baca isi unit dari FormData formulir admin. */
const KONDISI_SAH: readonly string[] = ['mulus', 'minus', 'part'];

export function unitDariForm(fd: FormData): UnitInput {
  const k = teksForm(fd, 'kondisi');
  return {
    nama: teksForm(fd, 'nama') || 'Unit tanpa nama',
    merk: teksForm(fd, 'merk'),
    seri: teksForm(fd, 'seri'),
    ram: teksForm(fd, 'ram'),
    kapasitas: teksForm(fd, 'kapasitas'),
    warna: teksForm(fd, 'warna'),
    kondisi: (KONDISI_SAH.includes(k) ? k : 'mulus') as Kondisi,
    harga: angkaForm(fd, 'harga'),
    hargaAsli: angkaAtauNull(fd, 'hargaAsli'),
    tersedia: checkboxOn(fd, 'tersedia'),
    tahunRilis: angkaAtauNull(fd, 'tahunRilis'),
    layar: teksForm(fd, 'layar'),
    baterai: teksForm(fd, 'baterai'),
    imei: teksForm(fd, 'imei').replace(/[^0-9\s/,]/g, ''),
    deskripsi: teksForm(fd, 'deskripsi'),
    kelengkapan: daftarForm(fd, 'kelengkapan'),
    catatan: daftarForm(fd, 'catatan'),
    foto: daftarForm(fd, 'foto'),
  };
}

/** Slugs diisi manual, atau otomatis dari nama. Kembalikan null saat slug ada yg sama. */
export async function slugDariForm(fd: FormData, nama: string, cekBentrok: (s: string) => boolean): Promise<string | null> {
  let slug = teksForm(fd, 'slug').toLowerCase();
  if (!slug) slug = slugify(nama);
  if (!slug) return null;
  // Slug dipakai sebagai nama file foto dan potongan URL, jadi hanya huruf kecil,
  // angka, dan strip. Tanpa ini, slug berisi "/" atau ".." bisa menulis file di
  // luar folder foto.
  if (slug.length > 80 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return null;
  if (cekBentrok(slug)) return null;
  return slug;
}

/** Proses file upload, lalu tempel nama baru di akhir daftar foto. */
export async function prosesFotoUpload(fd: FormData, slug: string, daftar: string[]): Promise<string[]> {
  const hasil = [...daftar];
  const files = fd.getAll('fotoBaru') as File[];
  for (const file of files) {
    if (file && 'size' in file && file.size > 0 && file.name) {
      hasil.push(await simpanFoto(file, slug));
    }
  }
  return hasil;
}

/**
 * Nama foto yang boleh dipakai sebuah unit. Foto yang diunggah untuk unit itu
 * selalu diawali slug-nya, jadi nama lain yang diketik manual bisa berarti file
 * milik seller atau unit lain. Tanpa saringan ini, satu seller bisa menaruh
 * foto penjual lain di produknya hanya dengan mengetik nama file-nya.
 */
export function saringFoto(nama: string[], slug: string): string[] {
  return nama.filter((n) => n === slug || n.startsWith(`${slug}-`));
}
