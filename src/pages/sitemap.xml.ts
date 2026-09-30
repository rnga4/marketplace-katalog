import type { APIRoute } from 'astro';
import { listUnits } from '../lib/db';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'http://localhost:8096';
  const pages = ['', ...listUnits().map((u) => `/hp/${u.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${origin}${p}</loc>
    <changefreq>daily</changefreq>
  </url>`,
  )
  .join('\n')}
</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};