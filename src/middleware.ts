import { defineMiddleware } from 'astro:middleware';

import { bacaSesi, COOKIE_ADMIN, COOKIE_AKUN } from './lib/auth';
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

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

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