import { db } from './db';

/**
 * Rate limit login disimpan di database, bukan di memori proses. Versi
 * sebelumnya pakai Map yang hilang begitu container restart, jadi kunci
 * hilang tepat saat paling butuh: saat ada yang mencoba menebak password.
 */

const MAKS = 5;
const KUNCI_MS = 15 * 60_000;

export const terkunci = (k: string): boolean => {
  const e = db.prepare('SELECT kunci, n, buka FROM percobaan WHERE kunci = ?').get(k) as
    | { n: number; buka: number }
    | undefined;
  return !!e && e.n >= MAKS && e.buka > Date.now();
};

export const catatGagal = (k: string): void => {
  const e = db.prepare('SELECT kunci, n, buka FROM percobaan WHERE kunci = ?').get(k) as
    | { n: number; buka: number }
    | undefined;
  const n = e && e.buka > Date.now() ? e.n : 0;
  db.prepare(
    `INSERT INTO percobaan (kunci, n, buka) VALUES (?, ?, ?)
     ON CONFLICT(kunci) DO UPDATE SET n = excluded.n, buka = excluded.buka`,
  ).run(k, n + 1, Date.now() + KUNCI_MS);
};

export const bersihkan = (k: string): void => {
  db.prepare('DELETE FROM percobaan WHERE kunci = ?').run(k);
};