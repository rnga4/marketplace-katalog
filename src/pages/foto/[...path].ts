import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FOTO_DIR } from '../../lib/db';

const EKSTENSI: Record<string, string> = {
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Melayani foto produk. Di produksi nginx yang menangani /foto langsung via
 * volume alias; rute ini ada supaya mode dev tanpa nginx tetap bisa menampilkan.
 */
export const GET: APIRoute = async ({ params }) => {
  const aman = basename(params.path ?? '');
  if (!aman || aman === '.' || aman === '..') return new Response('Not Found', { status: 404 });

  try {
    const data = await readFile(join(FOTO_DIR, aman));
    const ext = `.${aman.split('.').pop() ?? ''}`;
    return new Response(data, {
      headers: {
        'Content-Type': EKSTENSI[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
};

export const prerender = false;