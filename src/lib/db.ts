import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

import { ambilSemua, ambilSatu, pool, query, ubahBaris } from './koneksi';
import seed from '../data/hp.json';
import { SITE_AWAL, normalisasiWa, waValid, type Site } from '../data/site';
import { satuan, kapital } from './format';

/**
 * Layer data aplikasi. Semuanya asynchronous: lihat `koneksi.ts` untuk
 * alasannya. Konsekuensi yang harus diingat saat menyentuh file ini — setiap
 * pemanggil wajib `await`, dan tidak boleh ada satu pun `await` di dalam loop
 * yang tidak memang butuh sequential.
 */

export type Kondisi = 'mulus' | 'minus' | 'part';

export type Peran = 'admin' | 'seller';
export type Moderasi = 'menunggu' | 'tayang' | 'tolak';

export const LABEL_MODERASI: Record<Moderasi, string> = {
  menunggu: 'Menunggu review',
  tayang: 'Tayang',
  tolak: 'Ditolak',
};

export interface Pengguna {
  id: number;
  nomor: string;
  nama: string;
  peran: Peran;
  status: string;
  dibuatPada: number;
  /** Naik tiap ganti sandi; token dengan versi lama otomatis ditolak. */
  sesiVersi: number;
}

export interface Lapak {
  penggunaId: number;
  slug: string;
  nama: string;
  whatsapp: string;
  deskripsi: string;
  lokasi: string;
  /** Nama file foto profil toko, kosong berarti memakai inisial nama. */
  foto: string;
}

export interface Pengumuman {
  id: number;
  judul: string;
  isi: string;
  aktif: boolean;
  dibuatPada: number;
  diubahPada: number;
}

export interface UnitHp {
  slug: string;
  nama: string;
  merk: string;
  seri: string;
  ram: string;
  kapasitas: string;
  warna: string;
  kondisi: Kondisi;
  harga: number;
  hargaAsli: number | null;
  tersedia: boolean;
  tahunRilis: number | null;
  layar: string;
  baterai: string;
  imei: string;
  kelengkapan: string[];
  catatan: string[];
  deskripsi: string;
  foto: string[];
  /** null berarti unit ini milik admin, bukan seller. */
  pemilikId: number | null;
  moderasi: Moderasi;
  alasanModerasi: string;
}

/**
 * Foto masih disimpan di volume lokal, bukan di database. Foldernya dibuat di
 * sini supaya `foto.ts` bisa memakainya sebagai satu-satunya sumber letak file.
 */
export const DATA_DIR = process.env.DATA_DIR ?? resolve('data');
export const FOTO_DIR = join(DATA_DIR, 'foto');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(FOTO_DIR, { recursive: true });

/* ----- Statistik klik ----- */

export async function catatKlik(slug: string): Promise<void> {
  await query('INSERT INTO klik (slug, ts) VALUES (?, ?)', [slug, Date.now()]);
}

/** Jumlah klik WA per unit dalam N hari terakhir. */
export async function hitungKlik(hari = 30): Promise<Record<string, number>> {
  const rows = await ambilSemua<{ slug: string; n: string }>(
    'SELECT slug, COUNT(*) AS n FROM klik WHERE ts > ? GROUP BY slug',
    [Date.now() - hari * 86_400_000],
  );
  return Object.fromEntries(rows.map((r) => [r.slug, Number(r.n)]));
}

/** Hapus riwayat klik sebuah unit saat unitnya dihapus. */
export async function hapusKlik(slug: string): Promise<void> {
  await query('DELETE FROM klik WHERE slug = ?', [slug]);
}

/* ----- Kondisi & harga ----- */

export const LABEL_KONDISI: Record<Kondisi, string> = {
  mulus: 'Mulus',
  minus: 'Minus',
  part: 'Part',
};

export const MAKS_JUDUL_PENGUMUMAN = 120;
export const MAKS_ISI_PENGUMUMAN = 2000;

export function labelKondisi(kondisi: Kondisi): string {
  return LABEL_KONDISI[kondisi];
}

/** Harga coret hanya tampil bila benar-benar di atas harga jual. */
export function hargaTercoret(u: Pick<UnitHp, 'harga' | 'hargaAsli'>): number | null {
  if (!u.hargaAsli || u.hargaAsli <= u.harga) return null;
  return u.hargaAsli;
}

/* ----- Pengumuman ----- */

function barisKePengumuman(r: Record<string, unknown>): Pengumuman {
  return {
    id: Number(r.id),
    judul: String(r.judul ?? ''),
    isi: String(r.isi ?? ''),
    // Di Postgres kolom `aktif` sudah boolean. Versi lama membandingkan
    // `Number(aktif) === 1`, yang kebetulan masih benar untuk `true` tapi
    // diam-diam salah begitu tipenya berubah.
    aktif: r.aktif === true,
    dibuatPada: Number(r.dibuat_pada ?? 0),
    diubahPada: Number(r.diubah_pada ?? 0),
  };
}

/** Info yang ditulis admin. Urut dari yang paling baru. */
export async function listPengumuman(aktifSaja = false): Promise<Pengumuman[]> {
  const sql = aktifSaja
    ? 'SELECT * FROM pengumuman WHERE aktif = TRUE ORDER BY dibuat_pada DESC, id DESC'
    : 'SELECT * FROM pengumuman ORDER BY dibuat_pada DESC, id DESC';
  const rows = await ambilSemua<Record<string, unknown>>(sql);
  return rows.map(barisKePengumuman);
}

export async function ambilPengumuman(id: number): Promise<Pengumuman | null> {
  const r = await ambilSatu<Record<string, unknown>>('SELECT * FROM pengumuman WHERE id = ?', [id]);
  return r ? barisKePengumuman(r) : null;
}

/** Simpan baru atau perbarui yang sudah ada. `id` kosong berarti baris baru. */
export async function simpanPengumuman(input: {
  id?: number;
  judul: string;
  isi: string;
  aktif: boolean;
}): Promise<Pengumuman> {
  const sekarang = Date.now();
  if (input.id) {
    // `rowCount`, bukan `changes` seperti di SQLite.
    const berubah = await ubahBaris(
      'UPDATE pengumuman SET judul = ?, isi = ?, aktif = ?, diubah_pada = ? WHERE id = ?',
      [input.judul, input.isi, input.aktif, sekarang, input.id],
    );
    if (berubah === 0) throw new Error('Pengumuman tidak ditemukan.');
    const diubah = await ambilPengumuman(input.id);
    if (!diubah) throw new Error('Pengumuman tidak ditemukan.');
    return diubah;
  }
  // SQLite menyediakan `lastInsertRowid`; Postgres tidak, jadi id diminta
  // balik eksplisit dengan RETURNING.
  const hasil = await query<{ id: number }>(
    `INSERT INTO pengumuman (judul, isi, aktif, dibuat_pada, diubah_pada)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [input.judul, input.isi, input.aktif, sekarang, sekarang],
  );
  const baru = await ambilPengumuman(Number(hasil.rows[0]?.id ?? 0));
  if (!baru) throw new Error('Gagal menyimpan pengumuman.');
  return baru;
}

export async function setPengumumanAktif(id: number, aktif: boolean): Promise<void> {
  await query('UPDATE pengumuman SET aktif = ?, diubah_pada = ? WHERE id = ?', [
    aktif,
    Date.now(),
    id,
  ]);
}

export async function hapusPengumuman(id: number): Promise<void> {
  await query('DELETE FROM pengumuman WHERE id = ?', [id]);
}

/* ----- Pemetaan baris ke objek ----- */

function nilaiTeks(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function daftarTeks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
}

/** Baca kolom JSON; data yang rusak jangan sampai menjatuhkan seluruh halaman. */
function daftarJson(v: unknown): string[] {
  try {
    return daftarTeks(JSON.parse(String(v ?? '[]')));
  } catch {
    return [];
  }
}

function integerNilai(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function barisKeUnit(row: Record<string, unknown> | undefined): UnitHp | null {
  if (!row) return null;
  return {
    slug: String(row.slug),
    nama: String(row.nama ?? ''),
    merk: kapital(nilaiTeks(row.merk)),
    seri: nilaiTeks(row.seri),
    ram: satuan(nilaiTeks(row.ram), 'GB'),
    kapasitas: satuan(nilaiTeks(row.kapasitas), 'GB'),
    warna: kapital(nilaiTeks(row.warna)),
    kondisi: (row.kondisi === 'minus' || row.kondisi === 'part' ? row.kondisi : 'mulus') as Kondisi,
    harga: integerNilai(row.harga),
    hargaAsli: row.harga_asli === null || row.harga_asli === undefined ? null : integerNilai(row.harga_asli),
    tersedia: row.tersedia === true,
    tahunRilis: row.tahun_rilis === null || row.tahun_rilis === undefined ? null : integerNilai(row.tahun_rilis),
    layar: satuan(nilaiTeks(row.layar), 'inci'),
    baterai: satuan(nilaiTeks(row.baterai), 'mAh'),
    imei: nilaiTeks(row.imei),
    kelengkapan: daftarJson(row.kelengkapan),
    catatan: daftarJson(row.catatan),
    deskripsi: nilaiTeks(row.deskripsi),
    foto: daftarJson(row.foto),
    pemilikId: row.pemilik_id === null || row.pemilik_id === undefined ? null : integerNilai(row.pemilik_id),
    moderasi: (row.moderasi === 'menunggu' || row.moderasi === 'tolak' ? row.moderasi : 'tayang') as Moderasi,
    alasanModerasi: nilaiTeks(row.alasan_moderasi),
  };
}

function barisKePengguna(row: Record<string, unknown> | undefined): Pengguna | null {
  if (!row) return null;
  return {
    id: integerNilai(row.id),
    nomor: String(row.nomor ?? ''),
    nama: nilaiTeks(row.nama),
    peran: (row.peran === 'admin' ? 'admin' : 'seller') as Peran,
    status: nilaiTeks(row.status) || 'aktif',
    dibuatPada: integerNilai(row.dibuat_pada),
    sesiVersi: integerNilai(row.sesi_versi),
  };
}

function barisKeLapak(row: Record<string, unknown> | undefined): Lapak | null {
  if (!row) return null;
  return {
    penggunaId: integerNilai(row.pengguna_id),
    slug: String(row.slug ?? ''),
    nama: nilaiTeks(row.nama),
    whatsapp: nilaiTeks(row.whatsapp),
    deskripsi: nilaiTeks(row.deskripsi),
    lokasi: nilaiTeks(row.lokasi),
    foto: nilaiTeks(row.foto),
  };
}

/* ----- Unit HP ----- */

/**
 * Urutan katalog: unit tersedia dulu, lalu yang paling murah.
 * Hanya unit yang sudah lolos review yang boleh dilihat pembeli; unit milik
 * admin sendiri selalu lolos. Jangan pakai ini di halaman admin.
 */
export async function listUnits(): Promise<UnitHp[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT * FROM hp WHERE moderasi = 'tayang'
     ORDER BY tersedia DESC, harga ASC, slug ASC`,
  );
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

/** Unit katalog lengkap dengan identitas penjualnya, untuk halaman publik. */
export interface UnitKatalog extends UnitHp {
  /** Nama toko penjual. Unit milik admin memakai nama toko utama. */
  penjualNama: string;
  lapakSlug: string | null;
}

export interface LapakFilter {
  slug: string;
  nama: string;
  foto: string;
  jumlah: number;
}

export interface KatalogQuery {
  cari?: string;
  lapak?: string;
  kondisi?: Kondisi;
  halaman?: number;
  perHalaman?: number;
  /**
   * Batasi ke unit yang masih tersedia. Default true karena kartu katalog tidak
   * punya penanda "Terjual", jadi unit terjual akan terlihat bisa dibeli.
   */
  hanyaTersedia?: boolean;
}

export interface HasilKatalog {
  unit: UnitKatalog[];
  total: number;
  halaman: number;
  jumlahHalaman: number;
}

export const PER_HALAMAN = 24;

/**
 * Daftar unit untuk katalog publik: hanya yang tayang, dengan pencarian,
 * filter penjual, dan paginasi. Query-nya satu COUNT dan satu SELECT, jadi
 * tidak memuat seluruh tabel ke memori.
 */
export async function katalogUnit(q: KatalogQuery = {}): Promise<HasilKatalog> {
  const perHalaman = Math.min(Math.max(q.perHalaman ?? PER_HALAMAN, 1), 96);
  const syarat: string[] = ["hp.moderasi = 'tayang'"];
  if (q.hanyaTersedia !== false) syarat.push('hp.tersedia = TRUE');
  const nilai: (string | number)[] = [];

  // Setiap kata kunci harus cocok di salah satu kolom, jadi pembagian kata
  // memakai AND. Persen, garis bawah, dan backslash di-escape supaya pola
  // tidak memperlakukannya sebagai wildcard.
  //
  // ILIKE, bukan LIKE: SQLite membuat LIKE tidak membedakan huruf besar-kecil
  // untuk teks ASCII, sedangkan Postgres membedakannya. Tanpa ILIKE, pencarian
  // "iphone" tidak akan menemukan "iPhone" seperti sebelumnya.
  const kata = (q.cari ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const k of kata) {
    const pola = `%${k.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    syarat.push(
      "(hp.nama ILIKE ? ESCAPE '\\' OR hp.merk ILIKE ? ESCAPE '\\' OR hp.seri ILIKE ? ESCAPE '\\' OR hp.kapasitas ILIKE ? ESCAPE '\\' OR hp.warna ILIKE ? ESCAPE '\\' OR hp.deskripsi ILIKE ? ESCAPE '\\')",
    );
    nilai.push(pola, pola, pola, pola, pola, pola);
  }

  if (q.lapak) {
    syarat.push('l.slug = ?');
    nilai.push(q.lapak);
  }

  if (q.kondisi) {
    syarat.push('hp.kondisi = ?');
    nilai.push(q.kondisi);
  }

  const where = syarat.join(' AND ');
  const gabung =
    'FROM hp LEFT JOIN pengguna p ON p.id = hp.pemilik_id LEFT JOIN lapak l ON l.pengguna_id = hp.pemilik_id';

  const hitung = await ambilSatu<{ n: string }>(
    `SELECT COUNT(*) AS n ${gabung} WHERE ${where}`,
    nilai,
  );
  const total = Number(hitung?.n ?? 0);
  const jumlahHalaman = Math.max(1, Math.ceil(total / perHalaman));
  const halaman = Math.min(Math.max(q.halaman ?? 1, 1), jumlahHalaman);

  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT hp.*, p.nama AS penjual_nama, l.slug AS lapak_slug, l.nama AS lapak_nama
     ${gabung} WHERE ${where}
     ORDER BY hp.tersedia DESC, hp.harga ASC, hp.slug ASC
     LIMIT ? OFFSET ?`,
    [...nilai, perHalaman, (halaman - 1) * perHalaman],
  );

  const namaToko = (await ambilSite()).nama;
  const unit = rows
    .map((r) => {
      const u = barisKeUnit(r);
      if (!u) return null;
      const dariLapak = typeof r.lapak_nama === 'string' ? r.lapak_nama : '';
      return {
        ...u,
        penjualNama: dariLapak || namaToko || 'Penjual katalog',
        lapakSlug: typeof r.lapak_slug === 'string' ? r.lapak_slug : null,
      };
    })
    .filter((u): u is UnitKatalog => u !== null);

  return { unit, total, halaman, jumlahHalaman };
}

/** Lapak yang punya unit tayang, untuk dropdown filter penjual. */
export async function listLapakTayang(): Promise<LapakFilter[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT l.slug, l.nama, l.foto, COUNT(hp.slug) AS jumlah
     FROM lapak l JOIN hp ON hp.pemilik_id = l.pengguna_id AND hp.moderasi = 'tayang'
     GROUP BY l.slug, l.nama, l.foto
     ORDER BY jumlah DESC, l.nama ASC`,
  );
  return rows.map((r) => ({
    slug: String(r.slug),
    nama: String(r.nama ?? ''),
    foto: String(r.foto ?? ''),
    // COUNT mengembalikan bigint, yang sampai ke sini sebagai string. Tanpa
    // konversi ini `jumlah` jadi "3" dan perbandingan `> 1` selalu benar,
    // karena JavaScript membandingkan string dengan number secara leksikografis.
    jumlah: Number(r.jumlah ?? 0),
  }));
}

/** Lapak yang punya minimal satu unit tersedia, untuk daftar penjual di beranda. */
export async function listLapakTersedia(): Promise<LapakFilter[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT l.slug, l.nama, l.foto, COUNT(hp.slug) AS jumlah
     FROM lapak l JOIN hp ON hp.pemilik_id = l.pengguna_id
       AND hp.moderasi = 'tayang' AND hp.tersedia = TRUE
     GROUP BY l.slug, l.nama, l.foto
     ORDER BY jumlah DESC, l.nama ASC`,
  );
  return rows.map((r) => ({
    slug: String(r.slug),
    nama: String(r.nama ?? ''),
    foto: String(r.foto ?? ''),
    // COUNT mengembalikan bigint, yang sampai ke sini sebagai string.
    jumlah: Number(r.jumlah ?? 0),
  }));
}

/**
 * Angka ringkas beranda. Keduanya hitungan nyata dari katalog: unit yang masih
 * tayang dan tersedia, serta lapak yang punya minimal satu unit tersedia.
 * Nilai yang tidak bisa diverifikasi tidak ditampilkan (DESIGN.md).
 */
export async function statistikRingkas(): Promise<{ unitTersedia: number; penjual: number }> {
  const unit = await ambilSatu<{ n: string }>(
    "SELECT COUNT(*) AS n FROM hp WHERE moderasi = 'tayang' AND tersedia = TRUE",
  );
  const penjual = await ambilSatu<{ n: string }>(
    `SELECT COUNT(DISTINCT l.id) AS n FROM lapak l JOIN hp ON hp.pemilik_id = l.pengguna_id
     WHERE hp.moderasi = 'tayang' AND hp.tersedia = TRUE`,
  );
  return { unitTersedia: Number(unit?.n ?? 0), penjual: Number(penjual?.n ?? 0) };
}

/** Semua unit termasuk yang menunggu review dan ditolak. Hanya untuk admin. */
export async function listSemuaUnits(): Promise<UnitHp[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    'SELECT * FROM hp ORDER BY tersedia DESC, harga ASC, slug ASC',
  );
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

/**
 * Antrean review untuk admin. Nama pemilik, slug lapak, dan nomor WhatsApp
 * diambil lewat join supaya halaman antrean tidak perlu query per unit.
 */
export interface BarisModerasi extends UnitHp {
  sellerNama: string;
  sellerNomor: string;
  lapakSlug: string | null;
  lapakWhatsapp: string;
}

export async function listAntrean(moderasi: Moderasi = 'menunggu'): Promise<BarisModerasi[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT hp.*,
            p.nama  AS seller_nama,
            p.nomor AS seller_nomor,
            l.slug  AS lapak_slug,
            l.whatsapp AS lapak_whatsapp
     FROM hp
     LEFT JOIN pengguna p ON p.id = hp.pemilik_id
     LEFT JOIN lapak l ON l.pengguna_id = hp.pemilik_id
     WHERE hp.moderasi = ?
     ORDER BY hp.tersedia DESC, hp.harga ASC, hp.slug ASC`,
    [moderasi],
  );
  return rows
    .map((r) => {
      const unit = barisKeUnit(r);
      if (!unit) return null;
      return {
        ...unit,
        sellerNama: nilaiTeks(r.seller_nama),
        sellerNomor: nilaiTeks(r.seller_nomor),
        lapakSlug: typeof r.lapak_slug === 'string' ? r.lapak_slug : null,
        lapakWhatsapp: nilaiTeks(r.lapak_whatsapp),
      };
    })
    .filter((u): u is BarisModerasi => u !== null);
}

export async function jumlahAntrean(): Promise<Record<Moderasi, number>> {
  const rows = await ambilSemua<{ moderasi: string; n: string }>(
    'SELECT moderasi, COUNT(*) AS n FROM hp WHERE pemilik_id IS NOT NULL GROUP BY moderasi',
  );
  const hasil: Record<Moderasi, number> = { menunggu: 0, tayang: 0, tolak: 0 };
  for (const r of rows) {
    if (r.moderasi === 'menunggu' || r.moderasi === 'tayang' || r.moderasi === 'tolak') {
      hasil[r.moderasi] = Number(r.n);
    }
  }
  return hasil;
}

/** Antrean review: unit seller yang belum ditayangkan. */
export async function listModerasi(moderasi: Moderasi = 'menunggu'): Promise<UnitHp[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT * FROM hp WHERE moderasi = ? ORDER BY tersedia DESC, harga ASC, slug ASC`,
    [moderasi],
  );
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

export async function getUnit(slug: string): Promise<UnitHp | null> {
  const row = await ambilSatu<Record<string, unknown>>('SELECT * FROM hp WHERE slug = ?', [slug]);
  return barisKeUnit(row);
}

export function slugify(nama: string): string {
  const dasar = nama
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (dasar) return dasar;
  return `unit-${randomBytes(3).toString('hex')}`;
}

/* ----- Pengguna & lapak ----- */

/** Kata sandi seller memakai scrypt yang sama dengan admin, agar tidak ada dependency baru. */
function hashKataSandi(kataSandi: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(kataSandi, salt, 64, { N: SCRYPT_N }).toString('hex')}`;
}

/**
 * Verifikasi memakai scrypt versi async. Versi sync memblokir event loop, jadi
 * beberapa login serentak cukup untuk membuat seluruh situs berhenti merespons.
 */
function scryptUji(kataSandi: string, salt: string): Promise<Buffer> {
  return new Promise((selesai, gagal) => {
    scrypt(kataSandi, salt, 64, { N: SCRYPT_N }, (err, kunci) => {
      if (err) {
        gagal(err);
      } else {
        selesai(kunci);
      }
    });
  });
}

/**
 * Nomor WhatsApp adalah identitas login, bukan cuma kontak. Karena itu satu
 * nomor hanya boleh punya satu akun: nomor yang sama adalah cara paling murah
 * untuk mengambil alih lapak orang lain.
 */
export async function createPengguna(p: {
  nomor: string;
  nama: string;
  kataSandi: string;
  peran?: Peran;
}): Promise<Pengguna> {
  const nomor = normalisasiWa(p.nomor);
  if (!waValid(nomor)) throw new Error('Nomor WhatsApp tidak valid.');
  if (await adaPengguna(nomor))
    throw new Error('Nomor ini sudah dipakai akun lain. Satu seller satu nomor, satu akun.');
  const peran = p.peran ?? 'seller';
  // Auto-acc menyala berarti seller baru langsung bisa masuk. Kalau mati, akun
  // menunggu persetujuan admin supaya tidak ada orang asing yang langsung bisa
  // memasang produk tanpa dilihat.
  const status = peran === 'admin' || (await ambilAutoAcc()) ? 'aktif' : 'tunggu';
  await query(
    `INSERT INTO pengguna (nomor, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nomor, p.nama.trim(), hashKataSandi(p.kataSandi), peran, status, Date.now()],
  );
  const dibuat = await ambilPenggunaByNomor(nomor);
  if (!dibuat) throw new Error('Gagal menyimpan akun.');
  return dibuat;
}

export async function ambilPenggunaByNomor(nomor: string): Promise<Pengguna | null> {
  return barisKePengguna(
    await ambilSatu<Record<string, unknown>>(
      'SELECT id, nomor, nama, peran, status, dibuat_pada, sesi_versi FROM pengguna WHERE nomor = ?',
      [normalisasiWa(nomor)],
    ),
  );
}

export async function ambilPengguna(id: number): Promise<Pengguna | null> {
  return barisKePengguna(
    await ambilSatu<Record<string, unknown>>(
      'SELECT id, nomor, nama, peran, status, dibuat_pada, sesi_versi FROM pengguna WHERE id = ?',
      [id],
    ),
  );
}

export async function adaPengguna(nomor: string): Promise<boolean> {
  const row = await ambilSatu('SELECT 1 FROM pengguna WHERE nomor = ?', [normalisasiWa(nomor)]);
  return row !== undefined;
}

/* ----- Persetujuan seller ----- */

/** Seller yang mendaftar saat auto-acc mati, menunggu diputuskan admin. */
export async function listSellerMenunggu(): Promise<Pengguna[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    "SELECT id, nomor, nama, peran, status, dibuat_pada, sesi_versi FROM pengguna WHERE peran = 'seller' AND status = 'tunggu' ORDER BY dibuat_pada ASC",
  );
  return rows
    .map((r) => barisKePengguna(r))
    .filter((p): p is Pengguna => p !== null);
}

export async function jumlahSellerMenunggu(): Promise<number> {
  const row = await ambilSatu<{ n: string }>(
    "SELECT COUNT(*) AS n FROM pengguna WHERE peran = 'seller' AND status = 'tunggu'",
  );
  return Number(row?.n ?? 0);
}

/** Setujui (aktif) atau tolak (tolak) akun seller. Hanya menyentuh peran seller. */
export async function setStatusSeller(id: number, status: 'aktif' | 'tolak'): Promise<void> {
  await query("UPDATE pengguna SET status = ? WHERE id = ? AND peran = 'seller'", [status, id]);
}

/** Cocokkan kata sandi seller. Hash yang rusak dianggap gagal, bukan error. */
export async function cekKataSandiPengguna(id: number, kataSandi: string): Promise<boolean> {
  const row = await ambilSatu<{ kata_sandi?: string }>(
    'SELECT kata_sandi FROM pengguna WHERE id = ?',
    [id],
  );
  const simpan = row?.kata_sandi ?? '';
  if (!simpan.includes(':')) return false;
  const [salt, hash] = simpan.split(':');
  if (!salt || !hash) return false;
  const uji = await scryptUji(kataSandi, salt);
  const asli = Buffer.from(hash, 'hex');
  return uji.length === asli.length && timingSafeEqual(uji, asli);
}

/**
 * Ganti kata sandi seller. Versi sesi dinaikkan supaya token yang mungkin
 * sudah bocor berhenti berlaku; perangkat yang sedang dipakai mendapat token
 * baru dari pemanggil.
 */
export async function setKataSandiPengguna(id: number, kataSandi: string): Promise<void> {
  await query('UPDATE pengguna SET kata_sandi = ?, sesi_versi = sesi_versi + 1 WHERE id = ?', [
    hashKataSandi(kataSandi),
    id,
  ]);
}

/** Slug lapak unik; nama yang sama ditambahkan angka, bukan menolak pendaftaran. */
export async function slugLapak(nama: string): Promise<string> {
  const dasar = slugify(nama) || 'lapak';
  let kandidat = dasar;
  let n = 2;
  while (await ambilLapakBySlug(kandidat)) {
    kandidat = `${dasar}-${n}`;
    n += 1;
  }
  return kandidat;
}

export async function ambilLapak(penggunaId: number): Promise<Lapak | null> {
  return barisKeLapak(
    await ambilSatu<Record<string, unknown>>('SELECT * FROM lapak WHERE pengguna_id = ?', [
      penggunaId,
    ]),
  );
}

export async function ambilLapakBySlug(slug: string): Promise<Lapak | null> {
  return barisKeLapak(
    await ambilSatu<Record<string, unknown>>('SELECT * FROM lapak WHERE slug = ?', [slug]),
  );
}

export async function simpanLapak(penggunaId: number, l: Partial<Lapak>): Promise<Lapak> {
  const nama = (l.nama ?? '').trim();
  if (!nama) throw new Error('Nama toko tidak boleh kosong.');
  const ada = await ambilLapak(penggunaId);
  if (ada) {
    await query(
      'UPDATE lapak SET nama = ?, whatsapp = ?, deskripsi = ?, lokasi = ? WHERE pengguna_id = ?',
      [
        nama,
        normalisasiWa(l.whatsapp ?? ''),
        (l.deskripsi ?? '').trim(),
        (l.lokasi ?? '').trim(),
        penggunaId,
      ],
    );
  } else {
    await query(
      'INSERT INTO lapak (pengguna_id, slug, nama, whatsapp, deskripsi, lokasi) VALUES (?, ?, ?, ?, ?, ?)',
      [
        penggunaId,
        await slugLapak(nama),
        nama,
        normalisasiWa(l.whatsapp ?? ''),
        (l.deskripsi ?? '').trim(),
        (l.lokasi ?? '').trim(),
      ],
    );
  }
  const hasil = await ambilLapak(penggunaId);
  if (!hasil) throw new Error('Gagal menyimpan toko.');
  return hasil;
}

/** Ganti foto profil toko. Lapak harus sudah ada; ini tidak membuat lapak baru. */
export async function setFotoLapak(penggunaId: number, nama: string): Promise<void> {
  const berubah = await ubahBaris('UPDATE lapak SET foto = ? WHERE pengguna_id = ?', [
    nama.trim(),
    penggunaId,
  ]);
  if (berubah === 0) throw new Error('Lapak tidak ditemukan.');
}

/**
 * Nomor WhatsApp yang harus dipakai pembeli untuk menghubungi unit ini: nomor
 * lapak pemiliknya. Unit milik admin memakai nomor toko sebagai cadangan.
 * Seller yang belum mengisi nomor sengaja tidak memakai nomor toko, supaya
 * pesanan tidak pernah masuk ke akun yang bukan miliknya; di halaman produk
 * tombol WhatsApp-nya tidak ditampilkan.
 */
export async function waKontak(unit: Pick<UnitHp, 'pemilikId'>, bawaan: string): Promise<string> {
  if (unit.pemilikId === null) return bawaan;
  const lapak = await ambilLapak(unit.pemilikId);
  return lapak?.whatsapp ?? '';
}

export async function listUnitsPemilik(pemilikId: number): Promise<UnitHp[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    'SELECT * FROM hp WHERE pemilik_id = ? ORDER BY tersedia DESC, harga ASC, slug ASC',
    [pemilikId],
  );
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

/** Unit milik satu seller yang sudah tayang, untuk halaman lapak publik. */
export async function listUnitsLapak(penggunaId: number): Promise<UnitHp[]> {
  const rows = await ambilSemua<Record<string, unknown>>(
    `SELECT * FROM hp WHERE pemilik_id = ? AND moderasi = 'tayang'
     ORDER BY tersedia DESC, harga ASC, slug ASC`,
    [penggunaId],
  );
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

export async function setModerasi(slug: string, moderasi: Moderasi, alasan = ''): Promise<void> {
  await query('UPDATE hp SET moderasi = ?, alasan_moderasi = ? WHERE slug = ?', [
    moderasi,
    alasan,
    slug,
  ]);
}

export interface UnitInput {
  nama: string;
  merk?: string;
  seri?: string;
  ram?: string;
  kapasitas?: string;
  warna?: string;
  kondisi?: Kondisi;
  harga?: number;
  hargaAsli?: number | null;
  tersedia?: boolean;
  tahunRilis?: number | null;
  layar?: string;
  baterai?: string;
  imei?: string;
  kelengkapan?: string[];
  catatan?: string[];
  deskripsi?: string;
  foto?: string[];
  /** null = unit milik admin, langsung tayang. */
  pemilikId?: number | null;
}

/* ----- Auto-acc ----- */

const KUNCI_AUTO_ACC = 'auto_acc';

/**
 * Saklar global: saat menyala, unit seller langsung tayang dan pendaftaran seller
 * baru langsung aktif. Bawaannya mati supaya tidak ada produk atau akun yang masuk
 * katalog tanpa dilihat admin. Disimpan sebagai baris pengaturan terpisah, bukan
 * bagian blob identitas toko, karena bukan data yang diisi dari formulir.
 */
export async function ambilAutoAcc(): Promise<boolean> {
  const row = await ambilSatu<{ nilai?: string }>('SELECT nilai FROM pengaturan WHERE kunci = ?', [
    KUNCI_AUTO_ACC,
  ]);
  return row?.nilai === '1';
}

export async function simpanAutoAcc(on: boolean): Promise<void> {
  await query(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
    [KUNCI_AUTO_ACC, on ? '1' : '0'],
  );
}

/**
 * Status moderasi tidak pernah datang dari formulir; status diturunkan dari
 * siapa pemiliknya. Unit admin tayang langsung. Unit seller masuk antrean, kecuali
 * saat auto-acc menyala.
 *
 * Setiap edit pada unit seller, termasuk yang sebelumnya ditolak, mengembalikannya
 * ke antrean dan menghapus alasan penolakan lama. Kalau tidak begitu, seller yang
 * sudah memperbaiki fotonya tidak punya cara mengirim perbaikan itu untuk ditinjau,
 * dan produknya menggantung tak tayang sampai admin menekan Terima secara manual.
 */
async function moderasiSetelahUbah(pemilikId: number | null): Promise<Moderasi> {
  if (pemilikId === null) return 'tayang';
  return (await ambilAutoAcc()) ? 'tayang' : 'menunggu';
}

const INSERT = `
  INSERT INTO hp (
    slug, nama, merk, seri, ram, kapasitas, warna, kondisi,
    harga, harga_asli, tersedia, tahun_rilis, layar, baterai,
    kelengkapan, catatan, deskripsi, foto, imei, pemilik_id, moderasi, alasan_moderasi
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
`;

export async function createUnit(slug: string, i: UnitInput): Promise<UnitHp> {
  const pemilikId = i.pemilikId ?? null;
  await query(INSERT, [
    slug,
    i.nama,
    i.merk ?? '',
    i.seri ?? '',
    i.ram ?? '',
    i.kapasitas ?? '',
    i.warna ?? '',
    i.kondisi ?? 'mulus',
    i.harga ?? 0,
    i.hargaAsli ?? null,
    i.tersedia !== false,
    i.tahunRilis ?? null,
    i.layar ?? '',
    i.baterai ?? '',
    JSON.stringify(i.kelengkapan ?? []),
    JSON.stringify(i.catatan ?? []),
    i.deskripsi ?? '',
    JSON.stringify(i.foto ?? []),
    i.imei ?? '',
    pemilikId,
    await moderasiSetelahUbah(pemilikId),
  ]);
  const unit = await getUnit(slug);
  if (!unit) throw new Error('Gagal menyimpan unit.');
  return unit;
}

export async function updateUnit(slug: string, i: UnitInput): Promise<UnitHp> {
  const ada = await getUnit(slug);
  if (!ada) throw new Error('Unit tidak ditemukan.');
  await query(
    `UPDATE hp SET
      nama=?, merk=?, seri=?, ram=?, kapasitas=?, warna=?, kondisi=?,
      harga=?, harga_asli=?, tersedia=?, tahun_rilis=?, layar=?, baterai=?,
      kelengkapan=?, catatan=?, deskripsi=?, foto=?, imei=?, moderasi=?, alasan_moderasi=?
    WHERE slug=?`,
    [
      i.nama,
      i.merk ?? '',
      i.seri ?? '',
      i.ram ?? '',
      i.kapasitas ?? '',
      i.warna ?? '',
      i.kondisi ?? 'mulus',
      i.harga ?? 0,
      i.hargaAsli ?? null,
      i.tersedia !== false,
      i.tahunRilis ?? null,
      i.layar ?? '',
      i.baterai ?? '',
      JSON.stringify(i.kelengkapan ?? []),
      JSON.stringify(i.catatan ?? []),
      i.deskripsi ?? '',
      JSON.stringify(i.foto ?? []),
      i.imei ?? '',
      await moderasiSetelahUbah(ada.pemilikId),
      // Alasan penolakan lama tidak relevan lagi begitu produk masuk antrean ulang.
      '',
      slug,
    ],
  );
  const unit = await getUnit(slug);
  if (!unit) throw new Error('Unit gagal diperbarui.');
  return unit;
}

export async function deleteUnit(slug: string): Promise<void> {
  await query('DELETE FROM hp WHERE slug = ?', [slug]);
}

export async function setTersedia(slug: string, tersedia: boolean): Promise<void> {
  await query('UPDATE hp SET tersedia = ? WHERE slug = ?', [tersedia, slug]);
}

/* ----- Kata sandi admin (scrypt, bawaan Node, tanpa dependency) ----- */

const KUNCI_SANDI = 'admin_password_hash';
const SCRYPT_N = 16384;

async function simpanHash(hash: string): Promise<void> {
  await query(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
    [KUNCI_SANDI, hash],
  );
}

/**
 * Ganti kata sandi admin. Hash ditulis ke pengaturan (sumber yang dipakai
 * pastikanKataSandi) dan ke baris akun admin, supaya keduanya tidak pernah
 * berbeda kalau nanti login admin ikut memakai tabel pengguna. Versi sesi
 * dinaikkan agar token admin lama berhenti berlaku.
 */
export async function setKataSandi(kataSandi: string): Promise<void> {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(kataSandi, salt, 64, { N: SCRYPT_N }).toString('hex');
  const gabung = `${salt}:${hash}`;
  await simpanHash(gabung);
  await query("UPDATE pengguna SET kata_sandi = ?, sesi_versi = sesi_versi + 1 WHERE peran = 'admin'", [
    gabung,
  ]);
}

export async function cekKataSandi(kataSandi: string): Promise<boolean> {
  const row = await ambilSatu<{ nilai?: string }>('SELECT nilai FROM pengaturan WHERE kunci = ?', [
    KUNCI_SANDI,
  ]);
  const simpan = row?.nilai ?? '';
  if (!simpan.includes(':')) return false;
  const [salt, hash] = simpan.split(':');
  if (!salt || !hash) return false;
  const uji = await scryptUji(kataSandi, salt);
  const asli = Buffer.from(hash, 'hex');
  return uji.length === asli.length && timingSafeEqual(uji, asli);
}

/** Pastikan ada kata sandi tersimpan. Prioritas: env, lalu acak yang dicetak ke log. */
export async function pastikanKataSandi(): Promise<string | null> {
  if (await cekStoredSandi()) return null;

  const dariEnv = process.env.ADMIN_PASSWORD;
  if (dariEnv && dariEnv.length >= 6) {
    await setKataSandi(dariEnv);
    console.log('[admin] Kata sandi awal dibuat dari variabel ADMIN_PASSWORD.');
    return null;
  }

  const acak = randomBytes(9).toString('base64url');
  await setKataSandi(acak);
  console.log('======================================================');
  console.log('[admin] Kata sandi awal (acak) untuk login /admin:');
  console.log(`        ${acak}`);
  console.log('  Ubah lewat menu admin setelah login.');
  console.log('======================================================');
  return acak;
}

async function cekStoredSandi(): Promise<boolean> {
  const row = await ambilSatu('SELECT 1 FROM pengaturan WHERE kunci = ?', [KUNCI_SANDI]);
  return row !== undefined;
}

/* ----- Identitas toko (nama, WhatsApp) ----- */

const KUNCI_SITE = 'identitas';

/**
 * Identitas disimpan sebagai satu blob JSON, bukan satu baris per field, supaya
 * menambah field baru tidak perlu mengubah skema tabel.
 *
 * Cache ini hanya berlaku per proses. Admin yang mengubah nama
 * toko akan langsung terlihat di proses yang melakukannya, tapi proses lain
 * masih memakai nilai lama sampai cache-nya kedaluwarsa. Pada satu instance
 * hal ini tidak terasa; kalau nanti aplikasi dijalankan beberapa instance
 * bersamaan, perubahan di halaman admin perlu disertai cache purge.
 */
let cacheSite: Site | null = null;

/** Batas umur cache, supaya perubahan admin tidak menggantung terlalu lama. */
const UMUR_CACHE_SITE_MS = 60_000;
let cacheSitePada = 0;

export async function ambilSite(): Promise<Site> {
  if (cacheSite && Date.now() - cacheSitePada < UMUR_CACHE_SITE_MS) return cacheSite;
  const row = await ambilSatu<{ nilai?: string }>('SELECT nilai FROM pengaturan WHERE kunci = ?', [
    KUNCI_SITE,
  ]);
  let hasil: Site = { ...SITE_AWAL };
  if (row?.nilai) {
    try {
      const simpan = JSON.parse(String(row.nilai)) as Partial<Site>;
      for (const k of Object.keys(SITE_AWAL) as (keyof Site)[]) {
        const v = simpan[k];
        if (typeof v === 'string' && v.trim()) hasil[k] = v.trim();
      }
    } catch {
      console.warn('[db] Data identitas rusak, memakai nilai bawaan.');
    }
  }
  cacheSite = hasil;
  cacheSitePada = Date.now();
  return hasil;
}

export async function simpanSite(site: Site): Promise<void> {
  const bersih: Site = {
    nama: site.nama.trim(),
    namaLengkap: site.namaLengkap.trim(),
    tagline: site.tagline.trim(),
    deskripsi: site.deskripsi.trim(),
    bahasa: site.bahasa.trim() || 'id-ID',
    lokasi: site.lokasi.trim(),
    whatsapp: normalisasiWa(site.whatsapp),
  };
  if (!bersih.nama || !bersih.namaLengkap) {
    throw new Error('Nama toko tidak boleh kosong.');
  }
  await query(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
    [KUNCI_SITE, JSON.stringify(bersih)],
  );
  cacheSite = null;
}

/* ----- Admin sebagai akun pengguna ----- */

/**
 * Admin tidak lagi hidup sebagai satu kata sandi global tanpa identitas.
 * Baris peran 'admin' dibuat dari hash yang sudah tersimpan, jadi kata sandi
 * yang sedang dipakai tetap berlaku dan tidak perlu diatur ulang.
 */

export const NOMOR_ADMIN = 'admin';

export async function ambilAdmin(): Promise<Pengguna | null> {
  return barisKePengguna(
    await ambilSatu<Record<string, unknown>>(
      "SELECT id, nomor, nama, peran, status, dibuat_pada, sesi_versi FROM pengguna WHERE peran = 'admin' ORDER BY id LIMIT 1",
    ),
  );
}

/**
 * Bikin akun admin kalau belum ada, memakai hash yang sudah ada di pengaturan.
 * Databases yang belum punya kata sandi akan membuatnya lebih dulu lewat
 * pastikanKataSandi, lalu hash-nya dibaca ulang supaya tidak pernah kosong.
 *
 * `ON CONFLICT DO NOTHING` itu wajib, bukan hiasan: aplikasi boleh dijalankan
 * beberapa instance yang start bersamaan, dan tanpa itu keduanya akan mencoba
 * menyisipkan baris admin yang sama lalu salah satunya gagal dengan pelanggaran
 * keunikan — proses kedua ikut mati.
 */
export async function pastikanAdmin(): Promise<Pengguna> {
  const ada = await ambilAdmin();
  if (ada) return ada;

  await pastikanKataSandi();
  const row = await ambilSatu<{ nilai?: string }>(
    'SELECT nilai FROM pengaturan WHERE kunci = ?',
    [KUNCI_SANDI],
  );
  const hash = row?.nilai ?? '';
  if (!hash.includes(':')) throw new Error('Gagal menyiapkan akun admin: kata sandi tidak terbentuk.');

  await query(
    `INSERT INTO pengguna (nomor, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, 'admin', 'aktif', ?)
     ON CONFLICT (nomor) DO NOTHING`,
    [NOMOR_ADMIN, 'Admin', hash, Date.now()],
  );

  const dibuat = await ambilAdmin();
  if (!dibuat) throw new Error('Gagal menyiapkan akun admin.');
  return dibuat;
}

/* ----- Session Secret persistence ----- */

const KUNCI_SESSION_SECRET = 'session_secret';

/**
 * Rahasia penandatangan sesi dibaca sekali lalu disimpan di memori.
 *
 * Setiap permintaan yang memeriksa sesi menandatangani HMAC dengan nilai ini,
 * jadi membacanya dari database tiap kali akan menambah satu query ke setiap
 * halaman. Nilai yang dikembalikan selalu sama di semua instance karena diambil
 * dari baris `pengaturan` yang sama (dan `SESSION_SECRET` dari environment lebih
 * didahulukan lagi).
 */
let cacheSecret: string | null = null;

export async function ambilSessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cacheSecret) return cacheSecret;
  const row = await ambilSatu<{ nilai?: string }>('SELECT nilai FROM pengaturan WHERE kunci = ?', [
    KUNCI_SESSION_SECRET,
  ]);
  if (row?.nilai) {
    cacheSecret = row.nilai;
    return cacheSecret;
  }
  // `DO NOTHING`, bukan `DO UPDATE`. Kalau dua proses start bersamaan dan sama-
  // sama belum menemukan baris ini, keduanya membuat secret berbeda; dengan
  // DO UPDATE yang belakangan menimpa, sehingga proses penimpa memakai satu
  // nilai dan proses lain memakai nilai yang lain. Cookie yang ditandatangani
  // satu proses jadi tidak terbaca di proses lain, dan setiap restart
  // membatalkan semua sesi. DO NOTHING membuat hanya satu yang menang, lalu
  // semua proses membaca nilai milik pemenang itu.
  await query('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?) ON CONFLICT(kunci) DO NOTHING', [
    KUNCI_SESSION_SECRET,
    randomBytes(32).toString('hex'),
  ]);
  const pemenang = await ambilSatu<{ nilai?: string }>(
    'SELECT nilai FROM pengaturan WHERE kunci = ?',
    [KUNCI_SESSION_SECRET],
  );
  if (!pemenang?.nilai) throw new Error('Gagal menyiapkan session secret.');
  cacheSecret = pemenang.nilai;
  return cacheSecret;
}

/* ----- Pemangkasan tabel yang terus tumbuh ----- */

/**
 * Riwayat klik disimpan untuk statistik 30 hari, jadi 90 hari sudah lebih dari
 * cukup. Baris percobaan rate limit yang sudah kedaluwarsa juga dibuang supaya
 * tabelnya tidak tumbuh tanpa batas oleh IP yang terus berganti.
 */
const RETENSI_KLIK_HARI = 90;

async function pangkasLama(): Promise<void> {
  await query('DELETE FROM klik WHERE ts < ?', [Date.now() - RETENSI_KLIK_HARI * 86_400_000]);
  await query('DELETE FROM percobaan WHERE buka < ?', [Date.now()]);
}

/** Seed: cuma jalan saat tabel masih kosong. */
async function seedDemo(): Promise<void> {
  if (process.env.SEED_DEMO !== '1' || !Array.isArray(seed.hp)) return;
  const jumlah = await ambilSatu<{ n: string }>('SELECT COUNT(*) AS n FROM hp');
  if (Number(jumlah?.n ?? 0) !== 0) return;

  let sebanyak = 0;
  for (const s of seed.hp as UnitHp[]) {
    if (!s.slug || !s.nama) continue;
    await createUnit(s.slug, {
      nama: s.nama,
      merk: s.merk,
      seri: s.seri,
      ram: s.ram,
      kapasitas: s.kapasitas,
      warna: s.warna,
      kondisi: s.kondisi,
      harga: s.harga,
      hargaAsli: s.hargaAsli,
      tersedia: s.tersedia,
      tahunRilis: s.tahunRilis,
      layar: s.layar,
      baterai: s.baterai,
      kelengkapan: s.kelengkapan,
      catatan: s.catatan,
      deskripsi: s.deskripsi,
      foto: s.foto,
    });
    sebanyak += 1;
  }
  console.log(`[db] Database baru: ${sebanyak} unit contoh disemai dari data/hp.json.`);
}

let sudahSiap: Promise<void> | null = null;

/**
 * Persiapan sekali saja per proses: pastikan akun admin ada, pangkas baris
 * basi, jalankan seed kalau diminta, lalu nyalakan timer pemangkasan.
 *
 * Dulu semua ini berjalan begitu modul diimpor. Sekarang sengaja dipisah:
 * database hanya boleh disentuh setelah diminta, supaya tahap build (yang
 * nanti akan merender halaman statis dari data nyata) tidak diam-diam memicu
 * penulisan ke database produksi. Pemanggilnya `src/middleware.ts` dan
 * `src/pages/healthz.ts`.
 *
 * Aman dipanggil dari banyak request bersamaan: hanya satu eksekusi yang
 * berjalan, semuanya menunggu hasil yang sama.
 */
export function siapkanDatabase(): Promise<void> {
  if (!sudahSiap) {
    sudahSiap = (async () => {
      await pastikanAdmin();
      await pangkasLama();
      await seedDemo();
      const timer = setInterval(() => {
        pangkasLama().catch((err) =>
          console.error('[db] Pemangkasan gagal:', (err as Error).message),
        );
      }, 6 * 60 * 60 * 1000);
      (timer as { unref?: () => void }).unref?.();
    })().catch((err) => {
      // Kalau gagal, jangan mengunci kegagalan selamanya: request berikutnya
      // harus boleh mencoba lagi, misalnya setelah database selesai start.
      sudahSiap = null;
      throw err;
    });
  }
  return sudahSiap;
}

/** Tutup pool database. Dipanggil saat proses dihentikan. */
export async function tutupDatabase(): Promise<void> {
  await pool.end();
}