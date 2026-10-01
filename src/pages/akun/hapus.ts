import type { APIRoute } from 'astro';
import { COOKIE_AKUN } from '../../lib/auth';
import { teksForm, cekCsrf } from '../../lib/forms';
import { bacaSesi } from '../../lib/auth';
import { getUnit, deleteUnit } from '../../lib/db';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sesi = bacaSesi(cookies, COOKIE_AKUN, 'seller');
  if (!sesi?.penggunaId) return redirect('/masuk');
  const fd = await request.formData();
  if (!cekCsrf(fd, sesi)) return redirect('/akun?notif=salahfasilitas');

  const slug = teksForm(fd, 'slug');
  const unit = getUnit(slug);

  // Milik orang lain tidak boleh dihapus hanya karena slug-nya diketahui.
  if (unit && unit.pemilikId === sesi.penggunaId) {
    deleteUnit(slug);
    return redirect('/akun?notif=terhapus');
  }
  return redirect('/akun');
};

export const GET: APIRoute = ({ redirect }) => redirect('/akun');