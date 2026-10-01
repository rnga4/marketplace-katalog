import type { APIRoute } from 'astro';
import { getUnit, ambilSite, catatKlik, waKontak } from '../../lib/db';
import { linkWa, urlAbsolut } from '../../data/site';
import { rupiah, gabung } from '../../lib/format';

const BOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp/i;

export const GET: APIRoute = ({ params, request, site, redirect }) => {
  const slug = params.slug ?? '';
  // Sama seperti halaman detail, unit yang belum lolos review tidak dialihkan
  // ke WhatsApp siapa pun.
  const ditemukan = getUnit(slug);
  if (!ditemukan || ditemukan.moderasi !== 'tayang') return redirect('/', 302);
  const unit = ditemukan;

  const toko = ambilSite();
  const url = urlAbsolut(`/hp/${unit.slug}`, site);
  const pesan = `Halo, saya tertarik dengan ${unit.nama} (${gabung([unit.kapasitas, unit.warna])}), ${rupiah(unit.harga)}. Masih tersedia?\n${url}`;
  const tujuan = linkWa(pesan, waKontak(unit, toko.whatsapp), toko.nama);
  if (!tujuan) return redirect(`/hp/${unit.slug}`, 302);

  if (!BOT.test(request.headers.get('user-agent') ?? '')) catatKlik(unit.slug);
  return redirect(tujuan, 302);
};

export const prerender = false;
