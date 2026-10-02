import type { Sesi } from './auth';

/** Baca satu field teks dari FormData, di-trim. */
export function teksForm(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/** Textarea satu-per-baris menjadi array kebersih. */
export function daftarForm(fd: FormData, key: string): string[] {
  const v = fd.get(key);
  if (typeof v !== 'string') return [];
  return v
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Checkbox bernilai 'on' saat dicentang. */
export function checkboxOn(fd: FormData, key: string): boolean {
  return fd.get(key) === 'on';
}

/** Angka dari input yang boleh berisi titik ribuan ("3.100.000"). */
export function angkaForm(fd: FormData, key: string): number {
  const s = teksForm(fd, key).replace(/[^0-9]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Angka opsional; string kosong berarti null. */
export function angkaAtauNull(fd: FormData, key: string): number | null {
  const s = teksForm(fd, key).replace(/[^0-9]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Verifikasi token CSRF dari form terhadap sesi aktif. */
export function cekCsrf(fd: FormData, sesi: Sesi | null): boolean {
  return teksForm(fd, 'csrf') === sesi?.csrf;
}

/**
 * Slug dipakai sebagai nama file foto dan potongan URL, jadi hanya huruf kecil,
 * angka, dan strip. Tanpa ini, slug berisi "/" atau ".." bisa menulis file di
 * luar folder foto.
 */
export function slugValid(slug: string): boolean {
  return slug.length > 0 && slug.length <= 80 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug);
}

export const PILIHAN_KONDISI = [
  { nilai: 'mulus', label: 'Mulus' },
  { nilai: 'minus', label: 'Minus' },
  { nilai: 'part', label: 'Part' },
] as const;

export const NOTIF: Record<string, { jenis: 'ok' | 'err'; teks: string }> = {
  tersimpan: { jenis: 'ok', teks: 'Unit berhasil disimpan.' },
  terhapus: { jenis: 'ok', teks: 'Unit dihapus dari katalog.' },
  statusubah: { jenis: 'ok', teks: 'Status tersedia unit diperbarui.' },
  sandiubah: { jenis: 'ok', teks: 'Kata sandi berhasil diganti.' },
  salahfasilitas: { jenis: 'err', teks: 'Permintaan ditolak (token sesi tidak cocok).' },
  diterima: { jenis: 'ok', teks: 'Produk diterima dan sekarang tayang di katalog.' },
  'diterima lagi': { jenis: 'ok', teks: 'Produk diterima lagi dan sekarang tayang.' },
  ditolak: { jenis: 'ok', teks: 'Produk ditolak. Seller bisa melihat alasannya di akunnya.' },
  kirim: { jenis: 'ok', teks: 'Produk terkirim. Tunggu ditinjau admin sebelum tayang.' },
  tokosimpan: { jenis: 'ok', teks: 'Pengaturan toko disimpan.' },
  fotolapak: { jenis: 'ok', teks: 'Foto toko diperbarui.' },
  fotohapus: { jenis: 'ok', teks: 'Foto toko dihapus.' },
  sandiberubah: { jenis: 'ok', teks: 'Kata sandi berhasil diganti.' },
  pengumumansimpan: { jenis: 'ok', teks: 'Pengumuman disimpan.' },
  pengumumanhapus: { jenis: 'ok', teks: 'Pengumuman dihapus.' },
  pengumumanstatus: { jenis: 'ok', teks: 'Status pengumuman diperbarui.' },
  autoacc: { jenis: 'ok', teks: 'Setelan terima otomatis diperbarui.' },
  selleraktif: { jenis: 'ok', teks: 'Akun seller disetujui dan sekarang bisa masuk.' },
  sellertolak: { jenis: 'ok', teks: 'Pendaftaran seller ditolak.' },
};