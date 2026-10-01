import { defineMiddleware } from 'astro:middleware';

import { bacaSesi, COOKIE_ADMIN, COOKIE_AKUN } from './lib/auth';
import { ambilPengguna, type Pengguna } from './lib/db';

const LOGIN_ADMIN = '/admin/login';
const AREA_AKUN = ['/akun', '/akun/tambah', '/akun/edit'];

/**
 * Seller tidak boleh memakai akun yang sudah ditangguhkan. Status dibaca dari
 * database tiap request supaya pencabutan langsung berlaku tanpa menunggu
 * cookie kedaluwarsa.
 */
function sellerAktif(penggunaId: number): Pengguna | null {
  if (!penggunaId) return null;
  const p = ambilPengguna(penggunaId);
  return p && p.status === 'aktif' && p.peran === 'seller' ? p : null;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  // Area seller. Prefix dicek per segmen supaya /akunKu bukan ikut tertangkap.
  const diAreaAkun = AREA_AKUN.some((p) => path === p || path.startsWith(`${p}/`));
  if (diAreaAkun) {
    if (path === '/masuk' || path === '/daftar') return next();
    const sesi = bacaSesi(context.cookies, COOKIE_AKUN, 'seller');
    if (!sesi?.penggunaId) return context.redirect('/masuk');
    const pengguna = sellerAktif(sesi.penggunaId);
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
    const sesi = bacaSesi(context.cookies, COOKIE_ADMIN, 'admin');
    if (sesi) return context.redirect('/admin');
    return next();
  }

  const sesi = bacaSesi(context.cookies, COOKIE_ADMIN, 'admin');
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