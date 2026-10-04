import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * Satu-satunya tempat aplikasi ini bicara ke database.
 *
 * Versi sebelumnya memakai `node:sqlite` yang sinkron: setiap query menahan
* event loop sampai selesai. Itu sebabnya seluruh halaman hanya bisa dilayani
 * oleh satu thread, dan throughput-nya mentok di ~900 permintaan/detik walau
 * enam belas core nganggur. Driver `pg` bekerja asynchronous, jadi
 * Ribuan permintaan bisa menunggu jawaban database sekaligus tanpa satu pun
 * thread yang terblokir.
 *
 * Konsekuensinya semua fungsi di `db.ts` sekarang `async`, dan pemanggilnya
 * harus `await`. Kegagalan itu memang terlihat dari `astro check`, bukan
 * diam-diam.
 */

const URL = process.env.DATABASE_URL?.trim();

if (!URL) {
  throw new Error(
    'DATABASE_URL belum diisi. Aplikasi ini butuh database Postgres; lihat .env.example.',
  );
}

/**
 * Jumlah koneksi dibatasi dan sengaja kecil. Yang menentukan kapasitas bukan
 * jumlah koneksi, tapi core yang bisa menjalankan query: enam belas core ada
 * di host, sementara satu instance aplikasi hanya memakai satu core untuk
 * JavaScript dan sesekali menunggu database. Pool yang terlalu besar hanya
 * memindahkan antrean dari Node ke Postgres tanpa menambah throughput.
 */
export const pool = new Pool({
  connectionString: URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * Koneksi idle yang tiba-tiba putus (jaringan, atau Postgres yang direstart)
 * dijatuhkan diam-diam oleh driver, lalu diganti koneksi baru saat dibutuhkan.
 * Tanpa penanganan ini, proses akan keluar dengan error yang tidak jelas.
 */
pool.on('error', (err) => {
  console.error('[db] Koneksi database idle bermasalah:', err.message);
});

/**
 * Driver pg hanya mengenal placeholder bernomor (`$1`, `$2`, ...), sedangkan
 * seluruh SQL di `db.ts` masih ditulis dengan gaya `?` milik SQLite.
 *
 * Konversi dilakukan di sini, di satu tempat, supaya teks query di db.ts tetap
 * dibaca persis seperti sebelumnya dan tidak ada satu pun placeholder yang
 * salah nomor karena dihitung ulang secara manual. Aman karena tidak ada `?`
 * di dalam literal SQL manapun di db.ts — semua `?` memang placeholder.
 *
 * Perhatikan huruf besar `ESCAPE`: Postgres menuntut `ESCAPE` huruf besar,
 * sedangkan SQLite menerima huruf kecil. Semua query sudah memakainya.
 */
function kePlaceholderPg(sql: string): string {
  let ke = 0;
  return sql.replace(/\?/g, () => `$${++ke}`);
}

/** Jalankan query dan kembalikan objek hasil lengkap pg. */
export function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<R>> {
  return pool.query<R>(kePlaceholderPg(sql), params as unknown[]);
}

/** Baris pertama, atau `undefined` kalau tidak ada yang cocok. */
export async function ambilSatu<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R | undefined> {
  const hasil = await pool.query<R>(kePlaceholderPg(sql), params as unknown[]);
  return hasil.rows[0];
}

/** Semua baris sebagai array. Selalu array, tidak pernah `undefined`. */
export async function ambilSemua<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const hasil = await pool.query<R>(kePlaceholderPg(sql), params as unknown[]);
  return hasil.rows;
}

/**
 * Jumlah baris yang terpengaruh sebuah UPDATE atau DELETE.
 *
 * Driver pg tidak memberi objek seperti `{ changes }` milik SQLite; ia
 * menyimpan angkanya di `rowCount`, dan nilainya `null` saat tidak ada baris
 * yang cocok. Nol wajib dinormalkan supaya `=== 0` di pemanggil
 * tetap berarti "tidak ditemukan".
 */
export async function ubahBaris(sql: string, params: readonly unknown[] = []): Promise<number> {
  const hasil = await pool.query(kePlaceholderPg(sql), params as unknown[]);
  return hasil.rowCount ?? 0;
}

/**
 * Jalankan `f` di dalam transaksi, lalu commit atau rollback.
 *
 * Dipakai saat satu perubahan_logis butuh lebih dari satu statement — misalnya
 * menyimpan unit baru sekaligus mencatat kliknya. Tanpa ini, satu statement
 * bisa berhasil sementara yang berikutnya gagal dan meninggalkan data setengah
 * jadi.
 */
export async function transaksi<T>(f: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hasil = await f(client);
    await client.query('COMMIT');
    return hasil;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Koneksi sudah mati; transaksi sudah hilang bersama sesinya. */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Tutup pool dengan rapi. Dipanggil saat proses dihentikan supaya container
 * tidak menunggu koneksi menggantung saat docker stop.
 */
export async function tutupPool(): Promise<void> {
  await pool.end();
}