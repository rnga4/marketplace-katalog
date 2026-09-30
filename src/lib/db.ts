import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import seed from '../data/hp.json';
import { SITE_AWAL, normalisasiWa, type Site } from '../data/site';

export type Kondisi = 'mulus' | 'minus' | 'part';

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
  kelengkapan: string[];
  catatan: string[];
  deskripsi: string;
  foto: string[];
}

export const DATA_DIR = process.env.DATA_DIR ?? resolve('data');
export const FOTO_DIR = join(DATA_DIR, 'foto');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(FOTO_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'hp.db'));

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
    merk: nilaiTeks(row.merk),
    seri: nilaiTeks(row.seri),
    ram: nilaiTeks(row.ram),
    kapasitas: nilaiTeks(row.kapasitas),
    warna: nilaiTeks(row.warna),
    kondisi: (row.kondisi === 'minus' || row.kondisi === 'part' ? row.kondisi : 'mulus') as Kondisi,
    harga: integerNilai(row.harga),
    hargaAsli: row.harga_asli === null || row.harga_asli === undefined ? null : integerNilai(row.harga_asli),
    tersedia: row.tersedia !== 0,
    tahunRilis: row.tahun_rilis === null || row.tahun_rilis === undefined ? null : integerNilai(row.tahun_rilis),
    layar: nilaiTeks(row.layar),
    baterai: nilaiTeks(row.baterai),
    kelengkapan: daftarTeks(JSON.parse(String(row.kelengkapan ?? '[]'))),
    catatan: daftarTeks(JSON.parse(String(row.catatan ?? '[]'))),
    deskripsi: nilaiTeks(row.deskripsi),
    foto: daftarTeks(JSON.parse(String(row.foto ?? '[]'))),
  };
}

/** Urutan katalog: unit tersedia dulu, lalu yang paling murah. */
export function listUnits(): UnitHp[] {
  const rows = db
    .prepare('SELECT * FROM hp ORDER BY tersedia DESC, harga ASC, slug ASC')
    .all() as Record<string, unknown>[];
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
  kelengkapan?: string[];
  catatan?: string[];
  deskripsi?: string;
  foto?: string[];
}

const INSERT = `
  INSERT INTO hp (
    slug, nama, merk, seri, ram, kapasitas, warna, kondisi,
    harga, harga_asli, tersedia, tahun_rilis, layar, baterai,
    kelengkapan, catatan, deskripsi, foto
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function createUnit(slug: string, i: UnitInput): UnitHp {
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
      kelengkapan=?, catatan=?, deskripsi=?, foto=?
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

export function setKataSandi(kataSandi: string): void {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(kataSandi, salt, 64, { N: SCRYPT_N }).toString('hex');
  simpanHash(`${salt}:${hash}`);
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

// Pastikan password admin selalu ada di database
pastikanKataSandi();

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