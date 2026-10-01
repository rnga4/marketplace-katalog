import { db } from './db';

/**
 * Rate limit login disimpan di database, bukan di memori proses. Versi
 * sebelumnya pakai Map yang hilang begitu container restart, jadi kunci
 * hilang tepat saat paling butuh: saat ada yang mencoba menebak password.
 */

const MAKS = 5;
const KUNCI_MS = 15 * 60_000;

/** Semua kunci yang sedang aktif untuk satu percobaan login. */
export type Kunci = readonly string[];

/**
 * Kunci dihitung terpisah: login terkunci kalau IP atau nomornya sendiri
 * sudah melewati batas. Menjumlahkan semua penghitung akan membuat satu IP
 * yang mengetik dengan lima nomor berbeda ikut terkunci setelah tiga percobaan,
 * dengan lima nomor berbeda ikut terkunci setelah tiga percobaan, dan itu
 * bukan yang mau di sini — yang dilindungi adalah satu akun.
 */
export const terkunci = (kunci: Kunci): boolean => {
  const sekarang = Date.now();
  for (const k of kunci) {
    const e = db.prepare('SELECT n, buka FROM percobaan WHERE kunci = ?').get(k) as
      | { n: number; buka: number }
      | undefined;
    if (e && e.buka > sekarang && e.n >= MAKS) return true;
  }
  return false;
};

export const catatGagal = (kunci: Kunci): void => {
  for (const k of kunci) {
    const e = db.prepare('SELECT n, buka FROM percobaan WHERE kunci = ?').get(k) as
      | { n: number; buka: number }
      | undefined;
    const n = e && e.buka > Date.now() ? e.n : 0;
    db.prepare(
      `INSERT INTO percobaan (kunci, n, buka) VALUES (?, ?, ?)
       ON CONFLICT(kunci) DO UPDATE SET n = excluded.n, buka = excluded.buka`,
    ).run(k, n + 1, Date.now() + KUNCI_MS);
  }
};

export const bersihkan = (kunci: Kunci): void => {
  for (const k of kunci) db.prepare('DELETE FROM percobaan WHERE kunci = ?').run(k);
};