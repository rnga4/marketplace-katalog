/** Format angka ke Rupiah tanpa locale server (deterministik saat SSG). */
const formatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export function rupiah(nilai: number): string {
  return formatter.format(nilai);
}

/** Angka polos bertitik ribuan untuk isian form ("1500000" -> "1.500.000"). */
const ribuan = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function angkaRibuan(nilai: number | null | undefined): string {
  return typeof nilai === 'number' && Number.isFinite(nilai) ? ribuan.format(nilai) : '';
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
/** Angka polos jadi "angka satuan" ("8" -> "8 GB"). Isi yang sudah bersatuan dibiarkan. */
export function satuan(nilai: string, unit: string): string {
  return /^\d+([.,]\d+)?$/.test(nilai) ? `${nilai} ${unit}` : nilai;
}

/** Huruf pertama kapital ("pixel" -> "Pixel"). */
export function kapital(nilai: string): string {
  return nilai ? nilai.charAt(0).toUpperCase() + nilai.slice(1) : nilai;
}

/** Nama view-transition per unit (foto kartu ↔ foto detail). Sisa huruf/angka/strip
 *  saja bisa membuat dua slug berbeda jatuh ke nama yang sama, jadi sidik jari
 *  singkat dari slug aslinya ditambahkan. */
export function namaVt(slug: string): string {
  let sidik = 5381;
  for (let i = 0; i < slug.length; i++) sidik = ((sidik << 5) + sidik + slug.charCodeAt(i)) >>> 0;
  const aman = slug.replace(/[^a-z0-9-]/gi, '') || 'unit';
  return `foto-${aman}-${sidik.toString(36)}`;
}
