import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'http://localhost:8096';
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /go\n\nSitemap: ${origin}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};