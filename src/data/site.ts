/**
 * Identitas toko. Nilai bawaan di sini hanya dipakai kalau tabel `pengaturan`
 * masih kosong; begitu seller mengisi lewat /admin/pengaturan, nilai database
 * yang menang. Jadi tidak ada nomor telepon atau nama karangan yang ikut
 * terkirim ke pembeli.
 */

export interface Site {
  nama: string;
  namaLengkap: string;
  tagline: string;
  deskripsi: string;
  bahasa: string;
  lokasi: string;
  whatsapp: string;
}

export const SITE_AWAL: Site = {
  nama: 'Katalog HP Bekas',
  namaLengkap: 'Katalog HP Bekas',
  tagline: 'Unit bekas yang kondisinya dipasang apa adanya.',
  deskripsi:
    'Katalog HP bekas pribadi: setiap unit ditampilkan dengan foto dan kondisi jujurnya, lengkap dengan harga pas. COD atau kirim.',
  bahasa: 'id-ID',
  lokasi: 'Indonesia',
  whatsapp: '',
};

export function urlAbsolut(path: string, site: URL | undefined): string {
  return new URL(path, site ?? 'http://localhost:8096').href;
}

/**
 * Nomor WhatsApp dianggap sah kalau sudah diisi seller di panel. Nilai bawaan
 * sengaja kosong supaya tidak ada tombol yang mengarah ke nomor karangan di
 * situs yang sudah dipublikasikan.
 */
const POLA_WA = /^62[0-9]{8,14}$/;

export function normalisasiWa(masuk: string): string {
  let angka = masuk.replace(/[^0-9]/g, '');
  if (!angka) return '';
  // Nol di depan bisa berlapis ("0812", "0062812"), jadi dibuang dulu sebelum
  // diputuskan mau ditambah kode negara atau tidak.
  angka = angka.replace(/^0+/, '');
  if (!angka) return '';
  if (angka.startsWith('62')) return angka;
  if (angka.startsWith('8')) return `62${angka}`;
  return angka;
}

export function waValid(nomor: string): boolean {
  return POLA_WA.test(nomor);
}

/**
 * Huruf untuk kotak logo di header. Dipakai sebagai penanda sampai ada logo
 * asli, jadi ia harus turun dari nama toko, bukan teks tetap yang bisa
 * tertinggal setelah nama diganti.
 */
export function inisial(nama: string): string {
  const kata = nama
    .split(/[\s._-]+/)
    .map((k) => k.trim())
    .filter((k) => /^[a-z0-9]/i.test(k));
  const [pertama = '', kedua = ''] = kata;
  if (!pertama) return '?';
  if (!kedua) return pertama.slice(0, 2).toUpperCase();
  return `${pertama.charAt(0)}${kedua.charAt(0)}`.toUpperCase();
}

/**
 * Link WhatsApp ke satu nomor, atau null kalau nomornya belum diisi. Null
 * berarti pemanggil tidak boleh membuat tautan sama sekali, bukan membuat
 * tautan ke '#'. Nomor diteruskan sebagai argumen supaya jelas absoluta
 * panggilan ini memakai nomor siapa: nomor toko, atau nomor seller itu sendiri.
 */
export function linkWa(pesan: string | undefined, nomor: string, namaToko: string): string | null {
  if (!waValid(nomor)) return null;
  const teks = encodeURIComponent(
    pesan ?? `Halo, saya lihat katalog ${namaToko} dan mau tanya soal satu unit.`,
  );
  return `https://wa.me/${nomor}?text=${teks}`;
}
