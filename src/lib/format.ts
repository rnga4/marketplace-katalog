/** Format angka ke Rupiah tanpa locale server (deterministik saat SSG). */
const formatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export function rupiah(nilai: number): string {
  return formatter.format(nilai);
}

/** Gabung bagian yang boleh kosong dengan pemisah, jadi tidak pernah ada "·" yatim. */
export function gabung(bagian: (string | null | undefined)[]): string {
  return bagian.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).join(' · ');
}

export function rupiahRingkas(nilai: number): string {
  if (nilai >= 1_000_000) {
    const juta = nilai / 1_000_000;
    return `Rp${juta % 1 === 0 ? juta : juta.toFixed(1).replace('.', ',')} juta`;
  }
  return `Rp${Math.round(nilai / 1000)} rb`;
}