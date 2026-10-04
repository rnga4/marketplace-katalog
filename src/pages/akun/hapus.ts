import type { APIRoute } from 'astro';
import { COOKIE_AKUN } from '../../lib/auth';
import { teksForm, cekCsrf } from '../../lib/forms';
import { bacaSesi } from '../../lib/auth';
import { getUnit } from '../../lib/db';
import { hapusUnit } from '../../lib/hapusUnit';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sesi = await bacaSesi(cookies, COOKIE_AKUN, 'seller');
  if (!sesi?.penggunaId) return redirect('/masuk');
  const fd = await request.formData();
  if (!cekCsrf(fd, sesi)) return redirect('/akun?notif=salahfasilitas');

  const slug = teksForm(fd, 'slug');
  const unit = await getUnit(slug);

  // Milik orang lain tidak boleh dihapus hanya karena slug-nya diketahui.
  if (unit && unit.pemilikId === sesi.penggunaId) {
    await hapusUnit(slug);
    return redirect('/akun?notif=terhapus');
  }
  return redirect('/akun');
};

export const GET: APIRoute = ({ redirect }) => redirect('/akun');
