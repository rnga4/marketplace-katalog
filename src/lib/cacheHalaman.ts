/**
 * Cache HTML halaman publik di dalam proses aplikasi, dan kosongkan begitu ada
 * tulisan ke database.
 *
 * Nginx sempat menahan respons ruta yang di-proxy selama 30 detik. Cache itu
 * tidak tahu apa pun tentang perubahan data, jadi unit yang baru diunggah atau
 * dimoderasi baru muncul setelah 30 detik. Memindahkan cache ke dalam aplikasi
 * memberi satu tempat yang tahu: setiap fungsi tulis di `db.ts` memanggil
 * `bustCache()`, jadi tidak ada jalur tulis yang bisa lupa mengosongkan cache,
 * karena pemanggilnya menyatu dengan tempat datanya berubah.
 *
 * Sifat penting: yang disimpan hanya halaman tanpa sesi. Identitas di header
 * membuat satu seller melihat HTML berbeda dari pengunjung lain pada URL yang
 * sama, jadi halaman ber-sesi tidak pernah menyentuh cache ini dan selalu
 * dirender apa adanya.
 */

/** Batas umur satu entri. Bukan sumber kebenaran kesegaran, hanya pengaman. */
const TTL_MS = 60_000;

/**
 * Batas jumlah entri. Halaman publiknya sedikit, tapi pencarian bisa membuat
 * kunci baru tanpa henti, jadi jumlahnya perlu dijepit agar tidak memakan
 * memori. Lima ratus kunci sudah jauh melebihi kebutuhan situs ini.
 */
const MAKS_ENTRI = 500;

export interface Entri {
  html: string;
  status: number;
  header: [string, string][];
  disimpan: number;
}

const simpanan = new Map<string, Entri>();

/**
 * Render yang sedang berjalan untuk suatu kunci. Tanpa ini, request yang tiba
 * bersamaan untuk halaman yang belum ter-cache akan semuanya merender sendiri,
 * dan database yang baru saja keluar dari titik bottleneck ikut menanggung
 * lonjakan yang tidak perlu.
 */
const sedang = new Map<string, Promise<Entri | null>>();

/**
 * Halaman yang layak disimpan. Beranda dan katalog membaca `searchParams` untuk
 * pencarian dan filter, jadi kuncinya harus memuat query string utuh. Parameter
 * `q` sengaja dikecualikan karena tiap kata kunci baru hanya menambah satu
 * kunci yang tidak akan pernah dibaca lagi.
 */
export function jalurLayak(path: string, params: URLSearchParams): boolean {
  if (params.has('q')) return false;
  if (path === '/' || path === '/katalog') return true;
  return /^\/(hp|lapak)\/[^/]+$/.test(path);
}

/** Kunci cache: path plus query string, supaya tiap kombinasi filter punya salinannya sendiri. */
export function kunciCache(path: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/** Entri yang masih layak pakai, atau `undefined`. Yang kedaluwarsa langsung dibuang. */
export function ambilCache(kunci: string): Entri | undefined {
  const e = simpanan.get(kunci);
  if (!e) return undefined;
  if (Date.now() - e.disimpan > TTL_MS) {
    simpanan.delete(kunci);
    return undefined;
  }
  return e;
}

/**
 * Jalankan `render` lalu simpan hasilnya kalau memang layak jadi cache.
 * Request yang datang selagi render yang sama masih berjalan ikut memakai satu
 * hasil itu, bukan memulai render sendiri.
 *
 * `milikSendiri` memberi tahu pemanggil apakah dia yang memulai render. Kalau
 * bukan, pemanggil tidak boleh memakai respons milik orang lain dan harus
 * merender sendiri.
 */
export async function denganCache(
  kunci: string,
  render: () => Promise<Entri | null>,
): Promise<{ entri: Entri | null; milikSendiri: boolean }> {
  const jalan = sedang.get(kunci);
  if (jalan) return { entri: await jalan, milikSendiri: false };

  const sendiri = (async () => {
    const entri = await render();
    if (entri) {
      simpanan.set(kunci, entri);
      // Map mempertahankan urutan sisip, jadi entri paling awal adalah yang
      // paling mungkin sudah tidak pernah dibaca.
      while (simpanan.size > MAKS_ENTRI) {
        const tertua = simpanan.keys().next();
        if (tertua.done) break;
        simpanan.delete(tertua.value);
      }
    }
    return entri;
  })().finally(() => {
    sedang.delete(kunci);
  });

  sedang.set(kunci, sendiri);
  return { entri: await sendiri, milikSendiri: true };
}

/**
 * Kosongkan seluruh cache. Dipanggil dari lapisan driver di `koneksi.ts`,
 * setiap kali ada statement yang mengubah isi database.
 *
 * Sengaja tidak menerima daftar halaman yang terpengaruh. Menghitung halaman
 * mana yang berubah mudah salah dan baru ketahuan setelah katalog menampilkan
 * data basi, sedangkan mengosongkan semuanya hanya menyebabkan satu render
 * ulang yang mahal.
 */
export function bustCache(): void {
  simpanan.clear();
}