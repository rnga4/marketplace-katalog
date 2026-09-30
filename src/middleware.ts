import { defineMiddleware } from 'astro/middleware';

import { bacaSesi } from './lib/auth';

const HANYA_LOGIN = '/admin/login';

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  // Area publik / API tidak digantung.
  if (path !== '/admin' && !path.startsWith('/admin/')) {
    return next();
  }

  // Halaman login sendiri selalu boleh, tapi kalau sudah login langsung lewat.
  if (path === HANYA_LOGIN || path === `${HANYA_LOGIN}/`) {
    const sesi = bacaSesi(context.cookies);
    if (sesi) return context.redirect('/admin');
    return next();
  }

  const sesi = bacaSesi(context.cookies);
  if (!sesi) {
    return context.redirect(HANYA_LOGIN);
  }

  // Halaman logout juga menuntut sesi valid (paling tidak cookie ada).
  context.locals.admin = sesi;
  return next();
});

declare global {
  namespace App {
    interface Locals {
      admin?: import('./lib/auth').Sesi;
      flash?: { jenis: 'ok' | 'err'; teks: string };
    }
  }
}