import type { APIRoute } from 'astro';
import { listUnits, listLapakTayang } from '../lib/db';

/** Karakter yang harus di-escape supaya XML tidak rusak kalau nama toko memuatnya. */
function escXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'http://localhost:8096';
  // Halaman lapak ikut dipasang supaya profil seller bisa ditemukan lewat
  // pencarian, bukan cuma lewat katalog.
  const pages = [
    '',
    '/katalog',
    ...listUnits().map((u) => `/hp/${u.slug}`),
    ...listLapakTayang().map((l) => `/lapak/${l.slug}`),
  ];
  const isi = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${escXml(origin)}${escXml(p)}</loc>
    <changefreq>daily</changefreq>
  </url>`,
  )
  .join('\n')}
</urlset>`;
  return new Response(isi, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};