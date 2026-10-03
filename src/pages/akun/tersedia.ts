import type { APIRoute } from 'astro';
import { bacaSesi, COOKIE_AKUN } from '../../lib/auth';
import { teksForm, cekCsrf } from '../../lib/forms';
import { getUnit, setTersedia } from '../../lib/db';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sesi = bacaSesi(cookies, COOKIE_AKUN, 'seller');
  if (!sesi?.penggunaId) return redirect('/masuk');
  const fd = await request.formData();
  if (!cekCsrf(fd, sesi)) return redirect('/akun?notif=salahfasilitas');

  const slug = teksForm(fd, 'slug');
  const unit = getUnit(slug);

  // Seller lain tidak boleh mengubah status unit hanya karena tahu slug-nya.
  if (unit && unit.pemilikId === sesi.penggunaId) {
    setTersedia(slug, !unit.tersedia);
    return redirect('/akun?notif=statusubah');
  }
  return redirect('/akun');
};

export const GET: APIRoute = ({ redirect }) => redirect('/akun');
