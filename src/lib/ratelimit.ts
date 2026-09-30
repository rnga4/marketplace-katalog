const gagal = new Map<string, { n: number; buka: number }>();
const MAKS = 5;
const KUNCI_MS = 15 * 60_000;

export const terkunci = (k: string): boolean => {
  const e = gagal.get(k);
  return !!e && e.n >= MAKS && e.buka > Date.now();
};

export const catatGagal = (k: string): void => {
  const e = gagal.get(k);
  gagal.set(k, { n: (e && e.buka > Date.now() ? e.n : 0) + 1, buka: Date.now() + KUNCI_MS });
};

export const bersihkan = (k: string): void => {
  gagal.delete(k);
};
