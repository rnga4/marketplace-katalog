import { defineMiddleware } from 'astro:middleware';

import { bacaSesi, COOKIE_ADMIN, COOKIE_AKUN } from './lib/auth';
import { ambilCache, denganCache, jalurLayak, kunciCache, type Entri } from './lib/cacheHalaman';
import { ambilPengguna, siapkanDatabase, type Pengguna } from './lib/db';

const LOGIN_ADMIN = '/admin/login';

/**
 * Request yang tidak boleh menunggu database sama sekali: health check Docker
 * memanggilnya tiap 30 detik. Kalau tersangkut menunggu koneksi database,
 * healthcheck ikut gagal dan Docker bisa enfook ulang container yang sebenarnya
 * masih bisa melayani orang. Halaman ini sendiri sudah punya penanganan error
 * database sendiri di `src/pages/healthz.ts`.
 */
const TERCEPAT = new Set(['/healthz']);
const AREA_AKUN = ['/akun', '/akun/tambah', '/akun/edit'];

/**
 * Seller tidak boleh memakai akun yang sudah ditangguhkan. Status dibaca dari
 * database tiap request supaya pencabutan langsung berlaku tanpa menunggu
 * cookie kedaluwarsa.
 */
async function sellerAktif(penggunaId: number): Promise<Pengguna | null> {
  if (!penggunaId) return null;
  const p = await ambilPengguna(penggunaId);
  return p && p.status === 'aktif' && p.peran === 'seller' ? p : null;
}

/**
 * Halaman yang tersimpan di cache dirender ulang sebagai respons baru dari HTML
 * yang sudah ada. Status dan seluruh header ikut disalin, termasuk CSP yang
 * dipasang Astro, supaya halaman yang dilayani cache tidak lebih longgar
 * daripada yang baru saja dirender.
 *
 * `content-length` dan `content-encoding` sengaja dibuang: keduanya
 * menyatakan jumlah byte dari respons asli, bukan dari teks yang kita simpan.
 * Membiarkannya membuat nginx mengira halaman lebih panjang atau lebih pendek
 * dari aslinya.
 */
function keRespons(entri: Entri): Response {
  const header = new Headers(entri.header);
  header.delete('content-length');
  header.delete('content-encoding');
  return new Response(entri.html, { status: entri.status, headers: header });
}

/**
 * Tandai respons yang dilayani cache supaya bisa dibedakan dari yang baru
 * dirender tanpa harus menunggu parameter cache. Hanya dipasang di halaman
 * yang memang boleh di-cache, jadi halaman ber-sesi tidak pernah
 * menyebutkannya.
 */
function tandaiCache(res: Response, hit: boolean): Response {
  const header = new Headers(res.headers);
  header.set('x-cache', hit ? 'HIT' : 'MISS');
  return new Response(res.body, { status: res.status, headers: header });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  /* Halaman publik tanpa sesi dilayani dari cache sebelum menyentuh database
     sama sekali, termasuk `siapkanDatabase()`. Karena setiap fungsi tulis
     mengosongkan cache, unit yang baru diunggah tidak lagi menunggu masa ttl
     supaya muncul.

     Halaman ber-sesi sengaja dilewati: header memuat nama dan foto toko, jadi
     satu seller dan satu pengunjung tidak boleh menerima HTML yang sama. */
  const tanpaSesi =
    !context.cookies.has(COOKIE_ADMIN) && !context.cookies.has(COOKIE_AKUN);
  if (
    context.request.method === 'GET' &&
    tanpaSesi &&
    jalurLayak(path, context.url.searchParams)
  ) {
    const kunci = kunciCache(path, context.url.searchParams);
    const tersimpan = ambilCache(kunci);
    if (tersimpan) return tandaiCache(keRespons(tersimpan), true);

    // Disimpan di luar closure supaya hanya request yang benar-benar memulai
    // render yang boleh memakainya. Kalau render ini tidak menghasilkan entri
    // (misalnya 404 atau respons yang membawa Set-Cookie), pemanggil lain
    // harus merender sendiri dan tidak boleh memakai respons milik orang lain.
    let responsMilikSendiri: Response | null = null;
    const { entri } = await denganCache(kunci, async () => {
      await siapkanDatabase();
      const res = await next();
      responsMilikSendiri = res;
      if (res.status !== 200 || res.headers.has('set-cookie')) return null;
      // Body yang sudah dikompresi tidak bisa dibaca sebagai teks lalu ditulis
      // balik tanpa mengubah byte-nya, jadi respons terkompresi dilewati.
      if (res.headers.has('content-encoding')) return null;
      const header: [string, string][] = [];
      res.headers.forEach((v, k) => header.push([k, v]));
      return { html: await res.text(), status: res.status, header, disimpan: Date.now() };
    });
    if (entri) return tandaiCache(keRespons(entri), false);
    if (responsMilikSendiri) return responsMilikSendiri;
    return next();
  }

  // Persiapan database (akun admin, pemangkasan baris basi, seed) dijalankan
  // di sini, bukan di modul: setiap proses baru pasti menjalankannya satu kali
  // lalu request lain menunggu hasil yang sama. `siapkanDatabase()` yang
  // mengunci eksekusi, jadi request berikutnya tidak mengulang query yang sama.
  // `/healthz` dikecualikan supaya tidak ikut antre.
  if (!TERCEPAT.has(path)) await siapkanDatabase();

  // Area seller. Prefix dicek per segmen supaya /akunKu bukan ikut tertangkap.
  const diAreaAkun = AREA_AKUN.some((p) => path === p || path.startsWith(`${p}/`));
  if (diAreaAkun) {
    if (path === '/masuk' || path === '/daftar') return next();
    const sesi = await bacaSesi(context.cookies, COOKIE_AKUN, 'seller');
    if (!sesi?.penggunaId) return context.redirect('/masuk');
    const pengguna = await sellerAktif(sesi.penggunaId);
    if (!pengguna) {
      context.cookies.set(COOKIE_AKUN, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
      return context.redirect('/masuk');
    }
    context.locals.pengguna = pengguna;
    return next();
  }

  // Area publik / API tidak digantung.
  if (path !== '/admin' && !path.startsWith('/admin/')) {
    return next();
  }

  // Halaman login sendiri selalu boleh, tapi kalau sudah login langsung lewat.
  if (path === LOGIN_ADMIN || path === `${LOGIN_ADMIN}/`) {
    const sesi = await bacaSesi(context.cookies, COOKIE_ADMIN, 'admin');
    if (sesi) return context.redirect('/admin');
    return next();
  }

  const sesi = await bacaSesi(context.cookies, COOKIE_ADMIN, 'admin');
  if (!sesi) {
    return context.redirect(LOGIN_ADMIN);
  }

  // Halaman logout juga menuntut sesi valid (paling tidak cookie ada).
  context.locals.admin = sesi;
  return next();
});

declare global {
  namespace App {
    interface Locals {
      admin?: import('./lib/auth').Sesi;
      pengguna?: Pengguna;
      flash?: { jenis: 'ok' | 'err'; teks: string };
    }
  }
}