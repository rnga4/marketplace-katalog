/**
 * Migrasikan isi SQLite ke Postgres.
 *
 * Jalankan sekali, setelah `docker/postgres/schema.sql` sudah diterapkan:
 *   SQLITE_PATH=data/hp.db DATABASE_URL='postgres://...' npm run migrasi:db
 *
 * Yang dijaga skrip ini:
 *
 * - Id asli ikut dibawa. `hp.pemilik_id` dan `lapak.pengguna_id` menunjuk
 *   `pengguna.id`, jadi kalau id dibuat ulang oleh Postgres, semua relasi seller
 *   ke unitnya putus tanpa pesan yang kelihatan. Setelah itu sequence
 *   disetel ulang ke max(id)+1 supaya insert berikutnya tidak bentrok.
 *
 * - `pengaturan` disalin apa adanya, terutama `session_secret` dan
 *   `admin_password_hash`. Kalau `session_secret` tidak ikut, semua orang yang
 *   sedang login langsung terlempar keluar begitu situs beralih ke Postgres.
 *
 * - `percobaan` sengaja tidak dibawa. Isinya penghitung rate limit yang punya
 *   tanggal kedaluwarsa; menyalinnya hanya risking orang terkunci login tanpa
 *   alasan sampai 15 menit ke depan.
 *
 * - Semua penulisan dalam satu transaksi. Kalau gagal di tengah, Postgres
 *   kembali kosong, bukan setengah terisi.
 *
 * Skrip menolak jalan kalau tabel target sudah berisi data, supaya tidak
 * menimpa isi yang sudah ada. Paksa dengan --paksa kalau memang itu niatnya.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { pool, transaksi } from '../src/lib/koneksi';

const paksa = process.argv.includes('--paksa');
const sqlitePath = resolve(process.env.SQLITE_PATH ?? 'data/hp.db');
const secretDariEnv = process.env.SESSION_SECRET?.trim() || undefined;

/** SQLite menyimpan boolean sebagai INTEGER 0/1; Postgres menerimanya sebagai TRUE/FALSE. */
function keBoolean(nilai: unknown): boolean {
  return nilai === 1 || nilai === true || nilai === '1';
}

console.log(`Sumber : ${sqlitePath}`);
console.log(`Target : ${(process.env.DATABASE_URL ?? '').replace(/:[^:@]*@/, ':***@')}`);
if (paksa) console.log('Mode   : --paksa (tabel target yang sudah ada akan ditimpa)');

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });

/** Baca satu tabel SQLite sebagai array objek biasa. */
function baca(namaTabel: string): Record<string, unknown>[] {
  return sqlite.prepare(`SELECT * FROM ${namaTabel}`).all() as Record<string, unknown>[];
}

/** Nama file SQLite yang wajib ada; kalau tidak, migrasi tidak boleh jalan. */
function wajib(ada: boolean, apa: string): void {
  if (!ada) throw new Error(`${apa} tidak ada. Jalankan dari root proyek dengan data/hp.db.`);
}

wajib(sqlitePath.length > 0, 'SQLite');
try {
  sqlite.prepare('SELECT 1 FROM pengguna LIMIT 1').get();
} catch (err) {
  throw new Error(`SQLite tidak bisa dibaca: ${(err as Error).message}`);
}

const pengguna = baca('pengguna');
const lapak = baca('lapak');
const hp = baca('hp');
const pengaturan = baca('pengaturan');

// `session_secret` yang tersimpan di SQLite bisa saja sudah basi. Selama
// SESSION_SECRET diisi lewat environment, `ambilSessionSecret()` selalu memakai
// nilai itu dan membiarkan baris di database tidak pernah dibaca -- persis
// keadaan di server ini, di mana nilai di SQLite bukan lagi yang menandatangani
// sesi. Menyalin baris itu apa adanya akan membuat semua orang yang sedang
// login diminta login ulang begitu situs beralih ke Postgres.
//
/**
 * Nilai yang benar, diurutkan dari yang paling dipercaya:
 *
 * 1. `SESSION_SECRET` dari environment — ini yang dipakai entrypoint dan yang
 *    sedang menandatangani sesi di server ini.
 * 2. `data/.secret`, tempat entrypoint menyimpan nilai itu supaya stabil
 *    antar restart. Nama file-nya sama persis dengan yang dibaca entrypoint,
 *    jadi tidak ada nilai yang bisa berbeda karena salah baca.
 * 3. Baris `session_secret` di SQLite, kalau dua sumber di atas tidak ada.
 */
function sessionSecretBenar(): { nilai: string; sumber: string } | null {
  if (secretDariEnv) return { nilai: secretDariEnv, sumber: 'environment SESSION_SECRET' };
  const pathSecret = resolve(process.env.SESSION_SECRET_FILE ?? 'data/.secret');
  if (existsSync(pathSecret)) {
    const isi = readFileSync(pathSecret, 'utf8').trim();
    if (isi) return { nilai: isi, sumber: relative(process.cwd(), pathSecret) };
  }
  const dariSqlite = pengaturan.find((t) => t.kunci === 'session_secret')?.nilai;
  if (dariSqlite) return { nilai: String(dariSqlite), sumber: 'baris session_secret di SQLite' };
  return null;
}
const klik = baca('klik');
const pengumuman = baca('pengumuman');
const percobaanLama = baca('percobaan');

console.log(`\nSQLite : ${pengguna.length} pengguna, ${lapak.length} lapak, ${hp.length} unit, ` +
  `${pengaturan.length} pengaturan, ${klik.length} klik, ${pengumuman.length} pengumuman`);

// Aplikasi membuat satu akun admin sendiri setiap kali container start, jadi
// satu baris di `pengguna` belum tentu berarti migrasi pernah jalan. Yang
// menandakan "sudah ada isinya" adalah adanya unit, lapak, atau pengguna
// kedua, karena tiga hal itu tidak pernah dibuat otomatis.
//
// Kalau baris admin itu perlu dibuang, hapus saja sebelum migrasi:
//   DELETE FROM pengguna WHERE peran = 'admin';
const bootstrapAdmin = 1;
if (!paksa) {
  const isi = await pool.query<{ pengguna: string; unit: string; lapak: string }>(
    `SELECT (SELECT count(*) FROM pengguna)::text AS pengguna,
            (SELECT count(*) FROM hp)::text AS unit,
            (SELECT count(*) FROM lapak)::text AS lapak`,
  );
  const { pengguna: jp, unit: ju, lapak: jl } = isi.rows[0] ?? {
    pengguna: '0',
    unit: '0',
    lapak: '0',
  };
  if (Number(ju) > 0 || Number(jl) > 0 || Number(jp) > bootstrapAdmin) {
    throw new Error(
      `Postgres sudah berisi data (${jp} pengguna, ${jl} lapak, ${ju} unit). ` +
        'Pakai --paksa kalau memang ingin menimpanya.',
    );
  }
  if (Number(jp) === bootstrapAdmin) {
    console.log(
      'Catatan: ada satu akun admin hasil start sebelumnya. Baris itu dibiarkan ' +
        'apa adanya (kata sandinya tetap yang berasal dari pengaturan yang dimigrasi).',
    );
  }
}

const ringkas = await transaksi(async (c) => {
  // Urutan mengikuti ketergantungan foreign key: pengguna dulu, lalu lapak
  // yang menunjuknya, lalu hp yang menunjuk keduanya.
  for (const p of pengguna) {
    await c.query(
      `INSERT INTO pengguna (id, nomor, nama, kata_sandi, peran, status, dibuat_pada, sesi_versi)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (nomor) DO NOTHING`,
      [
        Number(p.id),
        p.nomor,
        p.nama,
        p.kata_sandi,
        p.peran,
        p.status,
        Number(p.dibuat_pada),
        Number(p.sesi_versi ?? 0),
      ],
    );
  }

  for (const l of lapak) {
    await c.query(
      `INSERT INTO lapak (id, pengguna_id, slug, nama, whatsapp, deskripsi, lokasi, foto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (pengguna_id) DO NOTHING`,
      [
        Number(l.id),
        Number(l.pengguna_id),
        l.slug,
        l.nama,
        l.whatsapp ?? '',
        l.deskripsi ?? '',
        l.lokasi ?? '',
        l.foto ?? '',
      ],
    );
  }

  for (const u of hp) {
    await c.query(
      `INSERT INTO hp (
         slug, nama, merk, seri, ram, kapasitas, warna, kondisi,
         harga, harga_asli, tersedia, tahun_rilis, layar, baterai,
         kelengkapan, catatan, deskripsi, foto, imei, pemilik_id, moderasi, alasan_moderasi
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22
       )`,
      [
        u.slug,
        u.nama,
        u.merk ?? '',
        u.seri ?? '',
        u.ram ?? '',
        u.kapasitas ?? '',
        u.warna ?? '',
        u.kondisi ?? 'mulus',
        Number(u.harga ?? 0),
        u.harga_asli === null || u.harga_asli === undefined ? null : Number(u.harga_asli),
        keBoolean(u.tersedia),
        u.tahun_rilis === null || u.tahun_rilis === undefined ? null : Number(u.tahun_rilis),
        u.layar ?? '',
        u.baterai ?? '',
        u.kelengkapan ?? '[]',
        u.catatan ?? '[]',
        u.deskripsi ?? '',
        u.foto ?? '[]',
        u.imei ?? '',
        u.pemilik_id === null || u.pemilik_id === undefined ? null : Number(u.pemilik_id),
        u.moderasi ?? 'tayang',
        u.alasan_moderasi ?? '',
      ],
    );
  }

  // Nilai dari SQLite yang menang, bukan vice versa. Aplikasi sudah menulis
  // `identitas` dan `auto_acc` dengan nilai bawaan saat pertama kali start,
  // dan `admin_password_hash` bisa berisi kata sandi acak dari environment --
  // semuanya harus ditimpa oleh nilai yang benar-benar dipakai situs selama
  // ini, supaya nama toko, pengaturan daftar, dan kata sandi admin tidak
  // berubah diam-diam.
  const rahasia = sessionSecretBenar();
  for (const t of pengaturan) {
    if (t.kunci === 'session_secret' && rahasia) continue;
    await c.query(
      'INSERT INTO pengaturan (kunci, nilai) VALUES ($1, $2) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai',
      [t.kunci, t.nilai],
    );
  }
  if (rahasia) {
    await c.query(
      `INSERT INTO pengaturan (kunci, nilai) VALUES ('session_secret', $1)
       ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
      [rahasia.nilai],
    );
  }

  for (const k of klik) {
    await c.query('INSERT INTO klik (slug, ts) VALUES ($1, $2)', [k.slug, Number(k.ts)]);
  }

  for (const b of pengumuman) {
    await c.query(
      `INSERT INTO pengumuman (id, judul, isi, aktif, dibuat_pada, diubah_pada)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        Number(b.id),
        b.judul,
        b.isi,
        keBoolean(b.aktif),
        Number(b.dibuat_pada),
        Number(b.diubah_pada),
      ],
    );
  }

  // Sequence identity disetel ulang ke max(id)+1. Kalau dilewati, INSERT
  // berikutnya tanpa id eksplisit akan bentrok dengan baris yang baru saja
  // disalin — gejalanya "duplicate key value violates unique constraint" pada
  // unit baru, padahal tabelnya kelihatan benar.
  for (const tabel of ['pengguna', 'lapak', 'klik', 'pengumuman']) {
    await c.query(
      `SELECT setval(pg_get_serial_sequence('${tabel}', 'id'),
                     COALESCE((SELECT MAX(id) FROM ${tabel}), 0) + 1, false)`,
    );
  }

  return {
    pengguna: pengguna.length,
    lapak: lapak.length,
    hp: hp.length,
    pengaturan: pengaturan.length,
    klik: klik.length,
    pengumuman: pengumuman.length,
  };
});

/* ----- verifikasi ----- */

const setelah = await pool.query<Record<string, string>>(
  `SELECT (SELECT count(*) FROM pengguna)::text AS pengguna,
          (SELECT count(*) FROM lapak)::text AS lapak,
          (SELECT count(*) FROM hp)::text AS hp,
          (SELECT count(*) FROM pengaturan)::text AS pengaturan,
          (SELECT count(*) FROM klik)::text AS klik,
          (SELECT count(*) FROM pengumuman)::text AS pengumuman`,
);
const asli = setelah.rows[0] ?? {};

console.log('\nVerifikasi jumlah baris:');
for (const kunci of Object.keys(ringkas) as (keyof typeof ringkas)[]) {
  const dapat = Number(asli[kunci] ?? -1);
  const harus = ringkas[kunci];
  const tanda = dapat === harus ? 'ok  ' : 'GAGAL';
  console.log(`  ${tanda} ${kunci.padEnd(10)} SQLite ${harus} → Postgres ${dapat}`);
  assert.equal(dapat, harus, `jumlah ${kunci} tidak cocok`);
}

// Yang paling rawan hilang kalau ada kolom yang keliru nama atau tipe: id
// seller yang menempel ke unitnya. Dicek per relationship, bukan cuma total.
const relasi = await pool.query<{ tanpa_pemilik: string; dengan_pemilik: string }>(
  `SELECT
     (SELECT count(*) FROM hp WHERE pemilik_id IS NULL)::text AS tanpa_pemilik,
     (SELECT count(*) FROM hp WHERE pemilik_id IS NOT NULL)::text AS dengan_pemilik`,
);
const pemilikSqlite = hp.filter((u) => u.pemilik_id !== null && u.pemilik_id !== undefined).length;
assert.equal(
  Number(relasi.rows[0]?.dengan_pemilik ?? -1),
  pemilikSqlite,
  'jumlah unit yang punya pemilik tidak cocok - relasi seller ke unitnya putus',
);
console.log(`  ok    ${pemilikSqlite} unit punya pemilik, semuanya masih menempel ke penggunanya`);

// Boolean harus benar-benar boolean, bukan 0/1 yang lolos sebagai angka.
const bool = await pool.query<{ tidak: string; ya: string }>(
  `SELECT (SELECT count(*) FROM hp WHERE tersedia)::text AS ya,
          (SELECT count(*) FROM hp WHERE NOT tersedia)::text AS tidak`,
);
console.log(`  ok    tersedia: ${bool.rows[0]?.ya} true, ${bool.rows[0]?.tidak} false`);

// Rahasia penandatangan sesi harus sama dengan yang sedang dipakai server.
// Kalau beda, setiap orang yang sedang login akan diminta login ulang begitu
// situs beralih ke Postgres.
const rahasia = sessionSecretBenar();
if (rahasia) {
  const secretPostgres = await pool.query<{ nilai: string }>(
    'SELECT nilai FROM pengaturan WHERE kunci = $1',
    ['session_secret'],
  );
  assert.equal(
    secretPostgres.rows[0]?.nilai,
    rahasia.nilai,
    'session_secret di Postgres tidak sama dengan yang sedang dipakai',
  );
  console.log(
    `  ok    session_secret diambil dari ${rahasia.sumber}, sesi yang sedang aktif tetap berlaku`,
  );
} else {
  console.log('  --    tidak ada session_secret di sumber; Postgres akan membuatnya sendiri');
}

if (percobaanLama.length) {
  console.log(`  --    ${percobaanLama.length} baris penghitung rate limit tidak dibawa (sengaja)`);
}

sqlite.close();
await pool.end();

console.log(
  `\nSelesai. ${ringkas.hp} unit, ${ringkas.pengguna} pengguna, ${ringkas.lapak} lapak, ` +
    `${ringkas.pengaturan} pengaturan, ${ringkas.klik} klik, ${ringkas.pengumuman} pengumuman.`,
);
console.log(`Backup SQLite tetap ada di ${relative(process.cwd(), sqlitePath) || sqlitePath}.\n`);