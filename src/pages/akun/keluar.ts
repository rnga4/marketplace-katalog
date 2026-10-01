import type { APIRoute } from 'astro';
import { COOKIE_AKUN } from '../../lib/auth';
import { teksForm } from '../../lib/forms';
import { bacaSesi } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sesi = bacaSesi(cookies, COOKIE_AKUN, 'seller');
  const fd = await request.formData();
  if (sesi && teksForm(fd, 'csrf') === sesi.csrf) {
    cookies.set(COOKIE_AKUN, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  }
  return redirect('/masuk');
};

export const GET: APIRoute = ({ redirect }) => redirect('/akun');