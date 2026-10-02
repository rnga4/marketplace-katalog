import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import seed from '../data/hp.json';
import { SITE_AWAL, normalisasiWa, waValid, type Site } from '../data/site';
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
  nomor: string;
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
    nomor         TEXT NOT NULL UNIQUE,
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
    lokasi        TEXT NOT NULL DEFAULT '',
    foto          TEXT NOT NULL DEFAULT ''
  );
`);

/**
 * Email diganti nomor WhatsApp sebagai identitas login. Banyak seller tidak
 * memakai email sama sekali, dan nomor mereka sudah bisa dihubungi pembeli,
 * jadi tidak perlu data kontak lain.
 *
 * Kolom email tidak bisa dikosongkan tanpa membangun ulang tabel, jadi tabel
 * dibangun ulang. Id dipertahankan supaya kepemilikan unit dan lapak tidak
 * putus.
 *
 * Foreign key dimatikan selama migrasi. Driver bawaan Node menyalakannya secara
 * default, jadi tanpa ini lpak yang menunjuk pengguna akan membuat DROP TABLE
 * gagal dan menyisakan pengguna_lama tertinggal di database.
 *
 * Tabel lapak ikut dibangun ulang. ALTER TABLE RENAME di SQLite menulis ulang
 * definisi foreign key di tabel lain supaya menunjuk nama baru, jadi setelah
 * pengguna_lama dihapus, lapak akan menunjuk tabel yang tidak ada lagi.
 * foreign_key_check dipakai sebagai gerbang: kalau masih ada yang rusak,
 * migrasi berhenti dengan pesan, bukan melanjutkan dengan relasi rusak.
 *
 * Syarat migrasi dicek ulang dari-awal, dan sisa pengguna_lama dari percobaan
 * yang gagal sebelumnya dibersihkan dulu supaya database tidak tersangkut di
 * tengah jalan.
 */
if ((db.prepare('PRAGMA table_info(pengguna)').all() as { name: string }[]).some((c) => c.name === 'email')) {
  db.exec('PRAGMA foreign_keys = OFF');
  const sisa = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pengguna_lama'")
    .get() as { name?: string } | undefined;
  if (sisa?.name) db.exec('DROP TABLE pengguna_lama');

  const lama = db.prepare('SELECT * FROM pengguna ORDER BY id').all() as Record<string, unknown>[];
  const pilihLapak = db.prepare('SELECT whatsapp FROM lapak WHERE pengguna_id = ?');

  db.exec('ALTER TABLE pengguna RENAME TO pengguna_lama');
  db.exec(`
    CREATE TABLE pengguna (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nomor         TEXT NOT NULL UNIQUE,
      nama          TEXT NOT NULL,
      kata_sandi    TEXT NOT NULL,
      peran         TEXT NOT NULL DEFAULT 'seller',
      status        TEXT NOT NULL DEFAULT 'aktif',
      dibuat_pada   INTEGER NOT NULL
    );

    CREATE TABLE lapak_baru (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pengguna_id   INTEGER NOT NULL UNIQUE REFERENCES pengguna(id),
      slug          TEXT NOT NULL UNIQUE,
      nama          TEXT NOT NULL,
      whatsapp      TEXT NOT NULL DEFAULT '',
      deskripsi     TEXT NOT NULL DEFAULT '',
      lokasi        TEXT NOT NULL DEFAULT '',
      foto          TEXT NOT NULL DEFAULT ''
    );

    INSERT INTO lapak_baru (id, pengguna_id, slug, nama, whatsapp, deskripsi, lokasi)
      SELECT id, pengguna_id, slug, nama, whatsapp, deskripsi, lokasi FROM lapak;

    DROP TABLE lapak;
    ALTER TABLE lapak_baru RENAME TO lapak;
  `);

  const sisip = db.prepare(
    `INSERT INTO pengguna (id, nomor, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const terpakai = new Set<string>();
  for (const u of lama) {
    const id = Number(u.id);
    const peran = String(u.peran ?? 'seller');
    // Nomor login diambil dari nomor WhatsApp lapak. Kalau kosong, memakai id
    // supaya setiap baris tetap punya identitas unik. Kolom UNIQUE di database
    // bisa ditabrak kalau dua seller kebetulan memakai nomor yang sama, jadi
    // nomor yang bentrok diberi akhiran: membiarkan INSERT gagal akan
    // menggagalkan seluruh migrasi dan menyisakan pengguna_lama tertinggal.
    const wa = String((pilihLapak.get(id) as { whatsapp?: string } | undefined)?.whatsapp ?? '');
    let nomor = peran === 'admin' ? 'admin' : normalisasiWa(wa) || `pengguna-${id}`;
    if (terpakai.has(nomor)) {
      let n = 2;
      while (terpakai.has(`${nomor}-${n}`)) n += 1;
      nomor = `${nomor}-${n}`;
    }
    terpakai.add(nomor);
    sisip.run(id, nomor, String(u.nama ?? ''), String(u.kata_sandi ?? ''), peran, String(u.status ?? 'aktif'), Number(u.dibuat_pada ?? Date.now()));
  }
  db.exec('DROP TABLE pengguna_lama');
  db.exec('PRAGMA foreign_keys = ON');
  const rusak = db.prepare('PRAGMA foreign_key_check').all() as Record<string, unknown>[];
  if (rusak.length) throw new Error('Migrasi pengguna merusak relasi. Batal, kembalikan database dari backup.');
}

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

/** Foto profil toko, ditambahkan seperti kolom pemilik: database lama tetap naik. */
if (!(db.prepare('PRAGMA table_info(lapak)').all() as { name: string }[]).some((c) => c.name === 'foto')) {
  db.exec("ALTER TABLE lapak ADD COLUMN foto TEXT NOT NULL DEFAULT ''");
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

db.exec(`
  CREATE TABLE IF NOT EXISTS pengumuman (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    judul       TEXT NOT NULL,
    isi         TEXT NOT NULL,
    aktif       INTEGER NOT NULL DEFAULT 1,
    dibuat_pada INTEGER NOT NULL,
    diubah_pada INTEGER NOT NULL
  );
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

export const MAKS_JUDUL_PENGUMUMAN = 120;
export const MAKS_ISI_PENGUMUMAN = 2000;

function barisKePengumuman(r: Record<string, unknown>): Pengumuman {
  return {
    id: Number(r.id),
    judul: String(r.judul ?? ''),
    isi: String(r.isi ?? ''),
    aktif: Number(r.aktif) === 1,
    dibuatPada: Number(r.dibuat_pada ?? 0),
    diubahPada: Number(r.diubah_pada ?? 0),
  };
}

/** Info yang ditulis admin. Urut dari yang paling baru. */
export function listPengumuman(aktifSaja = false): Pengumuman[] {
  const sql = aktifSaja
    ? 'SELECT * FROM pengumuman WHERE aktif = 1 ORDER BY dibuat_pada DESC, id DESC'
    : 'SELECT * FROM pengumuman ORDER BY dibuat_pada DESC, id DESC';
  return (db.prepare(sql).all() as Record<string, unknown>[]).map(barisKePengumuman);
}

export function ambilPengumuman(id: number): Pengumuman | null {
  const r = db.prepare('SELECT * FROM pengumuman WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? barisKePengumuman(r) : null;
}

/** Simpan baru atau perbarui yang sudah ada. `id` kosong berarti baris baru. */
export function simpanPengumuman(input: {
  id?: number;
  judul: string;
  isi: string;
  aktif: boolean;
}): Pengumuman {
  const sekarang = Date.now();
  if (input.id) {
    db.prepare('UPDATE pengumuman SET judul = ?, isi = ?, aktif = ?, diubah_pada = ? WHERE id = ?').run(
      input.judul,
      input.isi,
      input.aktif ? 1 : 0,
      sekarang,
      input.id,
    );
    return ambilPengumuman(input.id)!;
  }
  const hasil = db
    .prepare(
      'INSERT INTO pengumuman (judul, isi, aktif, dibuat_pada, diubah_pada) VALUES (?, ?, ?, ?, ?)',
    )
    .run(input.judul, input.isi, input.aktif ? 1 : 0, sekarang, sekarang);
  return ambilPengumuman(Number(hasil.lastInsertRowid))!;
}

export function setPengumumanAktif(id: number, aktif: boolean): void {
  db.prepare('UPDATE pengumuman SET aktif = ?, diubah_pada = ? WHERE id = ?').run(
    aktif ? 1 : 0,
    Date.now(),
    id,
  );
}

export function hapusPengumuman(id: number): void {
  db.prepare('DELETE FROM pengumuman WHERE id = ?').run(id);
}

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

/** Unit katalog lengkap dengan identitas penjualnya, untuk halaman publik. */
export interface UnitKatalog extends UnitHp {
  /** Nama toko penjual. Unit milik admin memakai nama toko utama. */
  penjualNama: string;
  lapakSlug: string | null;
}

export interface LapakFilter {
  slug: string;
  nama: string;
  /** Nama file foto profil toko, kosong berarti beranda memakai inisial nama. */
  foto: string;
  jumlah: number;
}

export interface KatalogQuery {
  cari?: string;
  lapak?: string;
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
export function katalogUnit(q: KatalogQuery = {}): HasilKatalog {
  const perHalaman = Math.min(Math.max(q.perHalaman ?? PER_HALAMAN, 1), 96);
  const syarat: string[] = ["hp.moderasi = 'tayang'"];
  if (q.hanyaTersedia !== false) syarat.push('hp.tersedia = 1');
  const nilai: (string | number)[] = [];

  // Setiap kata kunci harus cocok di salah satu kolom, jadi pembagian kata
  // memakai AND. Persen, garis bawah, dan backslash di-escape supaya pola
  // LIKE memperlakukannya sebagai teks biasa.
  const kata = (q.cari ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const k of kata) {
    const pola = `%${k.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    syarat.push(
      "(hp.nama LIKE ? ESCAPE '\\' OR hp.merk LIKE ? ESCAPE '\\' OR hp.seri LIKE ? ESCAPE '\\' OR hp.kapasitas LIKE ? ESCAPE '\\' OR hp.warna LIKE ? ESCAPE '\\' OR hp.deskripsi LIKE ? ESCAPE '\\')",
    );
    nilai.push(pola, pola, pola, pola, pola, pola);
  }

  if (q.lapak) {
    syarat.push('l.slug = ?');
    nilai.push(q.lapak);
  }

  const where = syarat.join(' AND ');
  const gabung =
    'FROM hp LEFT JOIN pengguna p ON p.id = hp.pemilik_id LEFT JOIN lapak l ON l.pengguna_id = hp.pemilik_id';

  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n ${gabung} WHERE ${where}`).get(...nilai) as { n: number }).n,
  );
  const jumlahHalaman = Math.max(1, Math.ceil(total / perHalaman));
  const halaman = Math.min(Math.max(q.halaman ?? 1, 1), jumlahHalaman);

  const rows = db
    .prepare(
      `SELECT hp.*, p.nama AS penjual_nama, l.slug AS lapak_slug, l.nama AS lapak_nama
       ${gabung} WHERE ${where}
       ORDER BY hp.tersedia DESC, hp.harga ASC, hp.slug ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...nilai, perHalaman, (halaman - 1) * perHalaman) as Record<string, unknown>[];

  const namaToko = ambilSite().nama;
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
export function listLapakTayang(): LapakFilter[] {
  return db
    .prepare(
      `SELECT l.slug, l.nama, COUNT(hp.slug) AS jumlah
       FROM lapak l JOIN hp ON hp.pemilik_id = l.pengguna_id AND hp.moderasi = 'tayang'
       GROUP BY l.slug, l.nama
       ORDER BY jumlah DESC, l.nama ASC`,
    )
    .all() as unknown as LapakFilter[];
}

/** Lapak yang punya minimal satu unit tersedia, untuk daftar penjual di beranda. */
export function listLapakTersedia(): LapakFilter[] {
  return db
    .prepare(
      `SELECT l.slug, l.nama, l.foto, COUNT(hp.slug) AS jumlah
       FROM lapak l JOIN hp ON hp.pemilik_id = l.pengguna_id
         AND hp.moderasi = 'tayang' AND hp.tersedia = 1
       GROUP BY l.slug, l.nama, l.foto
       ORDER BY jumlah DESC, l.nama ASC`,
    )
    .all() as unknown as LapakFilter[];
}

/**
 * Angka ringkas beranda. Keduanya hitungan nyata dari katalog: unit yang masih
 * tayang dan tersedia, serta lapak yang punya minimal satu unit tersedia.
 * Nilai yang tidak bisa diverifikasi tidak ditampilkan (DESIGN.md).
 */
export function statistikRingkas(): { unitTersedia: number; penjual: number } {
  const unitTersedia = Number(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM hp WHERE moderasi = 'tayang' AND tersedia = 1")
        .get() as { n: number }
    ).n,
  );
  const penjual = Number(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT l.id) AS n FROM lapak l JOIN hp ON hp.pemilik_id = l.pengguna_id
           WHERE hp.moderasi = 'tayang' AND hp.tersedia = 1`,
        )
        .get() as { n: number }
    ).n,
  );
  return { unitTersedia, penjual };
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
  sellerNomor: string;
  lapakSlug: string | null;
  lapakWhatsapp: string;
}

export function listAntrean(moderasi: Moderasi = 'menunggu'): BarisModerasi[] {
  const rows = db
    .prepare(
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
    )
    .all(moderasi) as Record<string, unknown>[];
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
    nomor: String(row.nomor ?? ''),
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
    foto: nilaiTeks(row.foto),
  };
}

/** Kata sandi seller memakai scrypt yang sama dengan admin, agar tidak ada dependency baru. */
function hashKataSandi(kataSandi: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(kataSandi, salt, 64, { N: SCRYPT_N }).toString('hex')}`;
}

/**
 * Nomor WhatsApp adalah identitas login, bukan cuma kontak. Karena itu satu
 * nomor hanya boleh punya satu akun: nomor yang sama adalah cara paling murah
 * untuk mengambil alih lapak orang lain.
 */
export function createPengguna(p: {
  nomor: string;
  nama: string;
  kataSandi: string;
  peran?: Peran;
}): Pengguna {
  const nomor = normalisasiWa(p.nomor);
  if (!waValid(nomor)) throw new Error('Nomor WhatsApp tidak valid.');
  if (adaPengguna(nomor)) throw new Error('Nomor ini sudah dipakai akun lain. Satu seller satu nomor, satu akun.');
  const peran = p.peran ?? 'seller';
  // Auto-acc menyala berarti seller baru langsung bisa masuk. Kalau mati, akun
  // menunggu persetujuan admin supaya tidak ada orang asing yang langsung bisa
  // memasang produk tanpa dilihat.
  const status = peran === 'admin' || ambilAutoAcc() ? 'aktif' : 'tunggu';
  db.prepare(
    `INSERT INTO pengguna (nomor, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(nomor, p.nama.trim(), hashKataSandi(p.kataSandi), peran, status, Date.now());
  const dibuat = ambilPenggunaByNomor(nomor);
  if (!dibuat) throw new Error('Gagal menyimpan akun.');
  return dibuat;
}

export function ambilPenggunaByNomor(nomor: string): Pengguna | null {
  return barisKePengguna(
    db.prepare('SELECT id, nomor, nama, peran, status, dibuat_pada FROM pengguna WHERE nomor = ?')
      .get(normalisasiWa(nomor)) as Record<string, unknown> | undefined,
  );
}

export function ambilPengguna(id: number): Pengguna | null {
  return barisKePengguna(
    db.prepare('SELECT id, nomor, nama, peran, status, dibuat_pada FROM pengguna WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined,
  );
}

export function adaPengguna(nomor: string): boolean {
  return db.prepare('SELECT 1 FROM pengguna WHERE nomor = ?').get(normalisasiWa(nomor)) !== undefined;
}

/* ----- Persetujuan seller ----- */

/** Seller yang mendaftar saat auto-acc mati, menunggu diputuskan admin. */
export function listSellerMenunggu(): Pengguna[] {
  return db
    .prepare(
      "SELECT id, nomor, nama, peran, status, dibuat_pada FROM pengguna WHERE peran = 'seller' AND status = 'tunggu' ORDER BY dibuat_pada ASC",
    )
    .all()
    .map((r) => barisKePengguna(r as Record<string, unknown>))
    .filter((p): p is Pengguna => p !== null);
}

export function jumlahSellerMenunggu(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM pengguna WHERE peran = 'seller' AND status = 'tunggu'")
    .get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Setujui (aktif) atau tolak (tolak) akun seller. Hanya menyentuh peran seller. */
export function setStatusSeller(id: number, status: 'aktif' | 'tolak'): void {
  db.prepare("UPDATE pengguna SET status = ? WHERE id = ? AND peran = 'seller'").run(status, id);
}

/** Cocokkan kata sandi seller. Hash yang rusak dianggap gagal, bukan error. */
export function cekKataSandiPengguna(id: number, kataSandi: string): boolean {
  const row = db.prepare('SELECT kata_sandi FROM pengguna WHERE id = ?').get(id) as
    | { kata_sandi?: string }
    | undefined;
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

/** Ganti foto profil toko. Lapak harus sudah ada; ini tidak membuat lapak baru. */
export function setFotoLapak(penggunaId: number, nama: string): void {
  const hasil = db.prepare('UPDATE lapak SET foto = ? WHERE pengguna_id = ?').run(nama.trim(), penggunaId);
  if (Number(hasil.changes) === 0) throw new Error('Lapak tidak ditemukan.');
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

/* ----- Auto-acc ----- */

const KUNCI_AUTO_ACC = 'auto_acc';

/**
 * Saklar global: saat menyala, unit seller langsung tayang dan pendaftaran seller
 * baru langsung aktif. Bawaannya mati supaya tidak ada produk atau akun yang masuk
 * katalog tanpa dilihat admin. Disimpan sebagai baris pengaturan terpisah, bukan
 * bagian blob identitas toko, karena bukan data yang diisi dari formulir.
 */
export function ambilAutoAcc(): boolean {
  const row = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(KUNCI_AUTO_ACC) as
    | { nilai?: string }
    | undefined;
  return row?.nilai === '1';
}

export function simpanAutoAcc(on: boolean): void {
  db.prepare(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
  ).run(KUNCI_AUTO_ACC, on ? '1' : '0');
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
function moderasiSetelahUbah(pemilikId: number | null): Moderasi {
  if (pemilikId === null) return 'tayang';
  return ambilAutoAcc() ? 'tayang' : 'menunggu';
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
    moderasiSetelahUbah(pemilikId),
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

export const NOMOR_ADMIN = 'admin';

export function ambilAdmin(): Pengguna | null {
  return barisKePengguna(
    db.prepare("SELECT id, nomor, nama, peran, status, dibuat_pada FROM pengguna WHERE peran = 'admin' ORDER BY id LIMIT 1")
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
    `INSERT INTO pengguna (nomor, nama, kata_sandi, peran, status, dibuat_pada)
     VALUES (?, ?, ?, 'admin', 'aktif', ?)`,
  ).run(NOMOR_ADMIN, 'Admin', hash, Date.now());

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