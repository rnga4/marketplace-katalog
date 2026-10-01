import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import seed from '../data/hp.json';
import { SITE_AWAL, normalisasiWa, type Site } from '../data/site';
import { satuan, kapital } from './format';

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
  email: string;
  nama: string;
  peran: Peran;
  status: string;
  dibuatPada: number;
}

export interface Lapak {
  penggunaId: number;
  slug: string;
  nama: string;
  whatsapp: string;
  deskripsi: string;
  lokasi: string;
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

export const DATA_DIR = process.env.DATA_DIR ?? resolve('data');
export const FOTO_DIR = join(DATA_DIR, 'foto');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(FOTO_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'hp.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS hp (
    slug        TEXT PRIMARY KEY,
    nama        TEXT NOT NULL,
    merk        TEXT NOT NULL DEFAULT '',
    seri        TEXT NOT NULL DEFAULT '',
    ram         TEXT NOT NULL DEFAULT '',
    kapasitas   TEXT NOT NULL DEFAULT '',
    warna       TEXT NOT NULL DEFAULT '',
    kondisi     TEXT NOT NULL DEFAULT 'mulus',
    harga       INTEGER NOT NULL DEFAULT 0,
    harga_asli  INTEGER,
    tersedia    INTEGER NOT NULL DEFAULT 1,
    tahun_rilis INTEGER,
    layar       TEXT NOT NULL DEFAULT '',
    baterai     TEXT NOT NULL DEFAULT '',
    kelengkapan TEXT NOT NULL DEFAULT '[]',
    catatan     TEXT NOT NULL DEFAULT '[]',
    deskripsi   TEXT NOT NULL DEFAULT '',
    foto        TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS pengaturan (
    kunci TEXT PRIMARY KEY,
    nilai TEXT NOT NULL
  );
`);

if (!(db.prepare('PRAGMA table_info(hp)').all() as { name: string }[]).some((c) => c.name === 'imei')) {
  db.exec("ALTER TABLE hp ADD COLUMN imei TEXT NOT NULL DEFAULT ''");
}

/* ----- Multi-seller: pengguna, lapak, dan kepemilikan unit ----- */

db.exec(`
  CREATE TABLE IF NOT EXISTS pengguna (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    nama          TEXT NOT NULL,
    kata_sandi    TEXT NOT NULL,
    peran         TEXT NOT NULL DEFAULT 'seller',
    status        TEXT NOT NULL DEFAULT 'aktif',
    dibuat_pada   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lapak (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pengguna_id   INTEGER NOT NULL UNIQUE REFERENCES pengguna(id),
    slug          TEXT NOT NULL UNIQUE,
    nama          TEXT NOT NULL,
    whatsapp      TEXT NOT NULL DEFAULT '',
    deskripsi     TEXT NOT NULL DEFAULT '',
    lokasi        TEXT NOT NULL DEFAULT ''
  );
`);

/**
 * Kolom pemilik ditambahkan satu per satu supaya database lama bisa naik
 * tanpa perlu dibangun ulang. Nullable karena unit lama belum punya seller;
 * unit milik admin sendiri bernilai null.
 */
const KOLOM_HP_BARU: readonly [string, string][] = [
  ['pemilik_id', 'INTEGER'],
  ['moderasi', "TEXT NOT NULL DEFAULT 'tayang'"],
  ['alasan_moderasi', "TEXT NOT NULL DEFAULT ''"],
];

for (const [kolom, tipe] of KOLOM_HP_BARU) {
  const ada = (db.prepare('PRAGMA table_info(hp)').all() as { name: string }[]).some(
    (c) => c.name === kolom,
  );
  if (!ada) db.exec(`ALTER TABLE hp ADD COLUMN ${kolom} ${tipe}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS percobaan (
    kunci TEXT PRIMARY KEY,
    n     INTEGER NOT NULL DEFAULT 0,
    buka  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hp_pemilik ON hp (pemilik_id);
  CREATE INDEX IF NOT EXISTS hp_moderasi ON hp (moderasi, tersedia);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS klik (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    ts   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS klik_slug_ts ON klik (slug, ts);
`);

export function catatKlik(slug: string): void {
  db.prepare('INSERT INTO klik (slug, ts) VALUES (?, ?)').run(slug, Date.now());
}

/** Jumlah klik WA per unit dalam N hari terakhir. */
export function hitungKlik(hari = 30): Record<string, number> {
  const rows = db
    .prepare('SELECT slug, COUNT(*) AS n FROM klik WHERE ts > ? GROUP BY slug')
    .all(Date.now() - hari * 86_400_000) as { slug: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.slug, Number(r.n)]));
}

export const LABEL_KONDISI: Record<Kondisi, string> = {
  mulus: 'Mulus',
  minus: 'Minus',
  part: 'Part',
};

export function labelKondisi(kondisi: Kondisi): string {
  return LABEL_KONDISI[kondisi];
}

/** Harga coret hanya tampil bila benar-benar di atas harga jual. */
export function hargaTercoret(u: Pick<UnitHp, 'harga' | 'hargaAsli'>): number | null {
  if (!u.hargaAsli || u.hargaAsli <= u.harga) return null;
  return u.hargaAsli;
}

function nilaiTeks(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function daftarTeks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
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
    tersedia: row.tersedia !== 0,
    tahunRilis: row.tahun_rilis === null || row.tahun_rilis === undefined ? null : integerNilai(row.tahun_rilis),
    layar: satuan(nilaiTeks(row.layar), 'inci'),
    baterai: satuan(nilaiTeks(row.baterai), 'mAh'),
    imei: nilaiTeks(row.imei),
    kelengkapan: daftarTeks(JSON.parse(String(row.kelengkapan ?? '[]'))),
    catatan: daftarTeks(JSON.parse(String(row.catatan ?? '[]'))),
    deskripsi: nilaiTeks(row.deskripsi),
    foto: daftarTeks(JSON.parse(String(row.foto ?? '[]'))),
    pemilikId: row.pemilik_id === null || row.pemilik_id === undefined ? null : integerNilai(row.pemilik_id),
    moderasi: (row.moderasi === 'menunggu' || row.moderasi === 'tolak' ? row.moderasi : 'tayang') as Moderasi,
    alasanModerasi: nilaiTeks(row.alasan_moderasi),
  };
}

/**
 * Urutan katalog: unit tersedia dulu, lalu yang paling murah.
 * Hanya unit yang sudah lolos review yang boleh dilihat pembeli; unit milik
 * admin sendiri selalu lolos. Jangan pakai ini di halaman admin.
 */
export function listUnits(): UnitHp[] {
  const rows = db
    .prepare(
      `SELECT * FROM hp WHERE moderasi = 'tayang'
       ORDER BY tersedia DESC, harga ASC, slug ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

/** Semua unit termasuk yang menunggu review dan ditolak. Hanya untuk admin. */
export function listSemuaUnits(): UnitHp[] {
  const rows = db
    .prepare('SELECT * FROM hp ORDER BY tersedia DESC, harga ASC, slug ASC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

/**
 * Antrean review untuk admin. Nama pemilik, slug lapak, dan nomor WhatsApp
 * diambil lewat join supaya halaman antrean tidak perlu query per unit.
 */
export interface BarisModerasi extends UnitHp {
  sellerNama: string;
  sellerEmail: string;
  lapakSlug: string | null;
  lapakWhatsapp: string;
}

export function listAntrean(moderasi: Moderasi = 'menunggu'): BarisModerasi[] {
  const rows = db
    .prepare(
      `SELECT hp.*,
              p.nama  AS seller_nama,
              p.email AS seller_email,
              l.slug  AS lapak_slug,
              l.whatsapp AS lapak_whatsapp
       FROM hp
       LEFT JOIN pengguna p ON p.id = hp.pemilik_id
       LEFT JOIN lapak l ON l.pengguna_id = hp.pemilik_id
       WHERE hp.moderasi = ?
       ORDER BY hp.tersedia DESC, hp.harga ASC, hp.slug ASC`,
    )
    .all(moderasi) as Record<string, unknown>[];
  return rows
    .map((r) => {
      const unit = barisKeUnit(r);
      if (!unit) return null;
      return {
        ...unit,
        sellerNama: nilaiTeks(r.seller_nama),
        sellerEmail: nilaiTeks(r.seller_email),
        lapakSlug: typeof r.lapak_slug === 'string' ? r.lapak_slug : null,
        lapakWhatsapp: nilaiTeks(r.lapak_whatsapp),
      };
    })
    .filter((u): u is BarisModerasi => u !== null);
}

export function jumlahAntrean(): Record<Moderasi, number> {
  const rows = db
    .prepare('SELECT moderasi, COUNT(*) AS n FROM hp WHERE pemilik_id IS NOT NULL GROUP BY moderasi')
    .all() as { moderasi: string; n: number }[];
  const hasil: Record<Moderasi, number> = { menunggu: 0, tayang: 0, tolak: 0 };
  for (const r of rows) {
    if (r.moderasi === 'menunggu' || r.moderasi === 'tayang' || r.moderasi === 'tolak') {
      hasil[r.moderasi] = Number(r.n);
    }
  }
  return hasil;
}

/** Antrean review: unit seller yang belum ditayangkan. */
export function listModerasi(moderasi: Moderasi = 'menunggu'): UnitHp[] {
  const rows = db
    .prepare(
      `SELECT * FROM hp WHERE moderasi = ? ORDER BY tersedia DESC, harga ASC, slug ASC`,
    )
    .all(moderasi) as Record<string, unknown>[];
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

export function getUnit(slug: string): UnitHp | null {
  const row = db.prepare('SELECT * FROM hp WHERE slug = ?').get(slug) as
    | Record<string, unknown>
    | undefined;
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

function barisKePengguna(row: Record<string, unknown> | undefined): Pengguna | null {
  if (!row) return null;
  return {
    id: integerNilai(row.id),
    email: String(row.email ?? ''),
    nama: nilaiTeks(row.nama),
    peran: (row.peran === 'admin' ? 'admin' : 'seller') as Peran,
    status: nilaiTeks(row.status) || 'aktif',
    dibuatPada: integerNilai(row.dibuat_pada),
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
  };
}

/** Kata sandi seller memakai scrypt yang sama dengan admin, agar tidak ada dependency baru. */
function hashKataSandi(kataSandi: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(kataSandi, salt, 64, { N: SCRYPT_N }).toString('hex')}`;
}

export function createPengguna(p: {
  email: string;
  nama: string;
  kataSandi: string;
  peran?: Peran;
}): Pengguna {
  const email = p.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Email tidak valid.');
  if (adaPengguna(email)) throw new Error('Email ini sudah terdaftar. Coba masuk saja.');
  db.prepare(
    `INSERT INTO pengguna (email, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, ?, 'aktif', ?)`,
  ).run(email, p.nama.trim(), hashKataSandi(p.kataSandi), p.peran ?? 'seller', Date.now());
  const dibuat = ambilPenggunaByEmail(email);
  if (!dibuat) throw new Error('Gagal menyimpan akun.');
  return dibuat;
}

export function ambilPenggunaByEmail(email: string): Pengguna | null {
  return barisKePengguna(
    db.prepare('SELECT id, email, nama, peran, status, dibuat_pada FROM pengguna WHERE email = ?')
      .get(email.trim().toLowerCase()) as Record<string, unknown> | undefined,
  );
}

export function ambilPengguna(id: number): Pengguna | null {
  return barisKePengguna(
    db.prepare('SELECT id, email, nama, peran, status, dibuat_pada FROM pengguna WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined,
  );
}

export function adaPengguna(email: string): boolean {
  return (
    db.prepare('SELECT 1 FROM pengguna WHERE email = ?').get(email.trim().toLowerCase()) !== undefined
  );
}

/** Cocokkan kata sandi seller. Hash yang rusak dianggap gagal, bukan error. */
export function cekKataSandiPengguna(email: string, kataSandi: string): boolean {
  const row = db.prepare('SELECT kata_sandi FROM pengguna WHERE email = ?')
    .get(email.trim().toLowerCase()) as { kata_sandi?: string } | undefined;
  const simpan = row?.kata_sandi ?? '';
  if (!simpan.includes(':')) return false;
  const [salt, hash] = simpan.split(':');
  if (!salt || !hash) return false;
  const uji = scryptSync(kataSandi, salt, 64, { N: SCRYPT_N });
  const asli = Buffer.from(hash, 'hex');
  return uji.length === asli.length && timingSafeEqual(uji, asli);
}

export function setKataSandiPengguna(id: number, kataSandi: string): void {
  db.prepare('UPDATE pengguna SET kata_sandi = ? WHERE id = ?').run(hashKataSandi(kataSandi), id);
}

/** Slug lapak unik; nama yang sama ditambahkan angka, bukan menolak pendaftaran. */
export function slugLapak(nama: string): string {
  const dasar = slugify(nama) || 'lapak';
  let kandidat = dasar;
  let n = 2;
  while (ambilLapakBySlug(kandidat)) {
    kandidat = `${dasar}-${n}`;
    n += 1;
  }
  return kandidat;
}

export function ambilLapak(penggunaId: number): Lapak | null {
  return barisKeLapak(
    db.prepare('SELECT * FROM lapak WHERE pengguna_id = ?').get(penggunaId) as
      | Record<string, unknown>
      | undefined,
  );
}

export function ambilLapakBySlug(slug: string): Lapak | null {
  return barisKeLapak(
    db.prepare('SELECT * FROM lapak WHERE slug = ?').get(slug) as Record<string, unknown> | undefined,
  );
}

export function simpanLapak(penggunaId: number, l: Partial<Lapak>): Lapak {
  const nama = (l.nama ?? '').trim();
  if (!nama) throw new Error('Nama toko tidak boleh kosong.');
  const ada = ambilLapak(penggunaId);
  if (ada) {
    db.prepare(
      'UPDATE lapak SET nama = ?, whatsapp = ?, deskripsi = ?, lokasi = ? WHERE pengguna_id = ?',
    ).run(nama, normalisasiWa(l.whatsapp ?? ''), (l.deskripsi ?? '').trim(), (l.lokasi ?? '').trim(), penggunaId);
  } else {
    db.prepare(
      'INSERT INTO lapak (pengguna_id, slug, nama, whatsapp, deskripsi, lokasi) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(penggunaId, slugLapak(nama), nama, normalisasiWa(l.whatsapp ?? ''), (l.deskripsi ?? '').trim(), (l.lokasi ?? '').trim());
  }
  const hasil = ambilLapak(penggunaId);
  if (!hasil) throw new Error('Gagal menyimpan toko.');
  return hasil;
}

/**
 * Nomor WhatsApp yang harus dipakai pembeli untuk menghubungi unit ini: nomor
 * lapak pemiliknya. Unit milik admin memakai nomor toko sebagai cadangan.
 * Seller yang belum mengisi nomor sengaja tidak memakai nomor toko, supaya
 * pesanan tidak pernah masuk ke akun yang bukan miliknya; di halaman produk
 * tombol WhatsApp-nya tidak ditampilkan.
 */
export function waKontak(unit: Pick<UnitHp, 'pemilikId'>, bawaan: string): string {
  if (unit.pemilikId === null) return bawaan;
  return ambilLapak(unit.pemilikId)?.whatsapp ?? '';
}

export function listUnitsPemilik(pemilikId: number): UnitHp[] {
  const rows = db
    .prepare('SELECT * FROM hp WHERE pemilik_id = ? ORDER BY tersedia DESC, harga ASC, slug ASC')
    .all(pemilikId) as Record<string, unknown>[];
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

/** Unit milik satu seller yang sudah tayang, untuk halaman lapak publik. */
export function listUnitsLapak(penggunaId: number): UnitHp[] {
  const rows = db
    .prepare(
      `SELECT * FROM hp WHERE pemilik_id = ? AND moderasi = 'tayang'
       ORDER BY tersedia DESC, harga ASC, slug ASC`,
    )
    .all(penggunaId) as Record<string, unknown>[];
  return rows.map((r) => barisKeUnit(r)).filter((u): u is UnitHp => u !== null);
}

export function setModerasi(slug: string, moderasi: Moderasi, alasan = ''): void {
  db.prepare('UPDATE hp SET moderasi = ?, alasan_moderasi = ? WHERE slug = ?').run(
    moderasi,
    alasan,
    slug,
  );
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

/**
 * Status moderasi tidak pernah datang dari formulir; status diturunkan dari
 * siapa pemiliknya. Unit admin tayang langsung, unit seller masuk antrean.
 *
 * Setiap edit pada unit seller, termasuk yang sebelumnya ditolak, mengembalikannya
 * ke antrean dan menghapus alasan penolakan lama. Kalau tidak begitu, seller yang
 * sudah memperbaiki fotonya tidak punya cara mengirim perbaikan itu untuk ditinjau,
 * dan produknya menggantung tak tayang sampai admin menekan Terima secara manual.
 */
function moderasiSetelahUbah(pemilikId: number | null): Moderasi {
  return pemilikId === null ? 'tayang' : 'menunggu';
}

const INSERT = `
  INSERT INTO hp (
    slug, nama, merk, seri, ram, kapasitas, warna, kondisi,
    harga, harga_asli, tersedia, tahun_rilis, layar, baterai,
    kelengkapan, catatan, deskripsi, foto, imei, pemilik_id, moderasi, alasan_moderasi
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
`;

export function createUnit(slug: string, i: UnitInput): UnitHp {
  const pemilikId = i.pemilikId ?? null;
  db.prepare(INSERT).run(
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
    i.tersedia === false ? 0 : 1,
    i.tahunRilis ?? null,
    i.layar ?? '',
    i.baterai ?? '',
    JSON.stringify(i.kelengkapan ?? []),
    JSON.stringify(i.catatan ?? []),
    i.deskripsi ?? '',
    JSON.stringify(i.foto ?? []),
    i.imei ?? '',
    pemilikId,
    pemilikId === null ? 'tayang' : 'menunggu',
  );
  const unit = getUnit(slug);
  if (!unit) throw new Error('Gagal menyimpan unit.');
  return unit;
}

export function updateUnit(slug: string, i: UnitInput): UnitHp {
  const ada = getUnit(slug);
  if (!ada) throw new Error('Unit tidak ditemukan.');
  db.prepare(`
    UPDATE hp SET
      nama=?, merk=?, seri=?, ram=?, kapasitas=?, warna=?, kondisi=?,
      harga=?, harga_asli=?, tersedia=?, tahun_rilis=?, layar=?, baterai=?,
      kelengkapan=?, catatan=?, deskripsi=?, foto=?, imei=?, moderasi=?, alasan_moderasi=?
    WHERE slug=?
  `).run(
    i.nama,
    i.merk ?? '',
    i.seri ?? '',
    i.ram ?? '',
    i.kapasitas ?? '',
    i.warna ?? '',
    i.kondisi ?? 'mulus',
    i.harga ?? 0,
    i.hargaAsli ?? null,
    i.tersedia === false ? 0 : 1,
    i.tahunRilis ?? null,
    i.layar ?? '',
    i.baterai ?? '',
    JSON.stringify(i.kelengkapan ?? []),
    JSON.stringify(i.catatan ?? []),
    i.deskripsi ?? '',
    JSON.stringify(i.foto ?? []),
    i.imei ?? '',
    moderasiSetelahUbah(ada.pemilikId),
    // Alasan penolakan lama tidak relevan lagi begitu produk masuk antrean ulang.
    '',
    slug,
  );
  const unit = getUnit(slug);
  if (!unit) throw new Error('Unit gagal diperbarui.');
  return unit;
}

export function deleteUnit(slug: string): void {
  db.prepare('DELETE FROM hp WHERE slug = ?').run(slug);
}

export function setTersedia(slug: string, tersedia: boolean): void {
  db.prepare('UPDATE hp SET tersedia = ? WHERE slug = ?').run(tersedia ? 1 : 0, slug);
}

/* ----- Kata sandi admin (scrypt, bawaan Node, tanpa dependency) ----- */

const KUNCI_SANDI = 'admin_password_hash';
const SCRYPT_N = 16384;

function simpanHash(hash: string): void {
  db.prepare(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
  ).run(KUNCI_SANDI, hash);
}

/**
 * Ganti kata sandi admin. Hash ditulis ke pengaturan (sumber yang dipakai
 * ensureKataSandi) dan ke baris akun admin, supaya keduanya tidak pernah
 * berbeda kalau nanti login admin ikut memakai tabel pengguna.
 */
export function setKataSandi(kataSandi: string): void {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(kataSandi, salt, 64, { N: SCRYPT_N }).toString('hex');
  const gabung = `${salt}:${hash}`;
  simpanHash(gabung);
  db.prepare("UPDATE pengguna SET kata_sandi = ? WHERE peran = 'admin'").run(gabung);
}

export function cekKataSandi(kataSandi: string): boolean {
  const row = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(KUNCI_SANDI) as
    | Record<string, unknown>
    | undefined;
  const simpan = row ? String(row.nilai) : '';
  if (!simpan.includes(':')) return false;
  const [salt, hash] = simpan.split(':');
  if (!salt || !hash) return false;
  const uji = scryptSync(kataSandi, salt, 64, { N: SCRYPT_N });
  const asli = Buffer.from(hash, 'hex');
  return uji.length === asli.length && timingSafeEqual(uji, asli);
}

/** Pastikan ada kata sandi tersimpan. Prioritas: env, lalu acak yang dicetak ke log. */
export function pastikanKataSandi(): string | null {
  if (cekStoredSandi()) return null;

  const dariEnv = process.env.ADMIN_PASSWORD;
  if (dariEnv && dariEnv.length >= 6) {
    setKataSandi(dariEnv);
    console.log('[admin] Kata sandi awal dibuat dari variabel ADMIN_PASSWORD.');
    return null;
  }

  const acak = randomBytes(9).toString('base64url');
  setKataSandi(acak);
  console.log('======================================================');
  console.log('[admin] Kata sandi awal (acak) untuk login /admin:');
  console.log(`        ${acak}`);
  console.log('  Ubah lewat menu admin setelah login.');
  console.log('======================================================');
  return acak;
}

function cekStoredSandi(): boolean {
  const row = db.prepare('SELECT 1 FROM pengaturan WHERE kunci = ?').get(KUNCI_SANDI) as
    | Record<string, unknown>
    | undefined;
  return row !== undefined;
}

/* ----- Identitas toko (nama, WhatsApp) ----- */

const KUNCI_SITE = 'identitas';

/**
 * Identitas disimpan sebagai satu blob JSON, bukan satu baris per field, supaya
 * menambah field baru tidak perlu mengubah skema tabel.
 */
let cacheSite: Site | null = null;

export function ambilSite(): Site {
  if (cacheSite) return cacheSite;
  const row = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(KUNCI_SITE) as
    | Record<string, unknown>
    | undefined;
  let hasil: Site = { ...SITE_AWAL };
  if (row) {
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
  return hasil;
}

export function simpanSite(site: Site): void {
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
  db.prepare(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
  ).run(KUNCI_SITE, JSON.stringify(bersih));
  cacheSite = null;
}

/* ----- Admin sebagai akun pengguna -----
 * Admin tidak lagi hidup sebagai satu kata sandi global tanpa identitas.
 * Baris peran 'admin' dibuat dari hash yang sudah tersimpan, jadi kata sandi
 * yang sedang dipakai tetap berlaku dan tidak perlu diatur ulang.
 */

export const EMAIL_ADMIN = 'admin@lapak';

export function ambilAdmin(): Pengguna | null {
  return barisKePengguna(
    db.prepare("SELECT id, email, nama, peran, status, dibuat_pada FROM pengguna WHERE peran = 'admin' ORDER BY id LIMIT 1")
      .get() as Record<string, unknown> | undefined,
  );
}

/**
 * Bikin akun admin kalau belum ada, memakai hash yang sudah ada di pengaturan.
 * Databases yang belum punya kata sandi akan membuatnya lebih dulu lewat
 * pastikanKataSandi, lalu hash-nya dibaca ulang supaya tidak pernah kosong.
 */
export function pastikanAdmin(): Pengguna {
  const ada = ambilAdmin();
  if (ada) return ada;

  pastikanKataSandi();
  const row = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(KUNCI_SANDI) as
    | { nilai?: string }
    | undefined;
  const hash = row?.nilai ?? '';
  if (!hash.includes(':')) throw new Error('Gagal menyiapkan akun admin: kata sandi tidak terbentuk.');

  db.prepare(
    `INSERT INTO pengguna (email, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, 'admin', 'aktif', ?)`,
  ).run(EMAIL_ADMIN, 'Admin', hash, Date.now());

  const dibuat = ambilAdmin();
  if (!dibuat) throw new Error('Gagal menyiapkan akun admin.');
  return dibuat;
}

/* ----- Session Secret persistence ----- */

const KUNCI_SESSION_SECRET = 'session_secret';

export function ambilSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(KUNCI_SESSION_SECRET) as
    | Record<string, unknown>
    | undefined;
  if (row && typeof row.nilai === 'string' && row.nilai) {
    return row.nilai;
  }
  const secretBaru = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
  ).run(KUNCI_SESSION_SECRET, secretBaru);
  return secretBaru;
}

/* ----- Seed: cuma jalan saat tabel masih kosong ----- */

// Pastikan kata sandi dan akun admin selalu ada di database
pastikanAdmin();

const jumlah = db.prepare('SELECT COUNT(*) AS n FROM hp').get() as { n: number };

if (Number(jumlah.n) === 0 && process.env.SEED_DEMO === '1' && Array.isArray(seed.hp)) {
  let sebanyak = 0;
  for (const s of seed.hp as UnitHp[]) {
    if (!s.slug || !s.nama) continue;
    createUnit(s.slug, {
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