import type { APIRoute } from 'astro';
import { COOKIE_ADMIN } from '../../lib/auth';
import { teksForm } from '../../lib/forms';
import { bacaSesi } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sesi = bacaSesi(cookies);
  const fd = await request.formData();
  if (sesi && teksForm(fd, 'csrf') === sesi.csrf) {
    cookies.set(COOKIE_ADMIN, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  }
  return redirect('/admin/login');
};

export const GET: APIRoute = ({ redirect }) => redirect('/admin');