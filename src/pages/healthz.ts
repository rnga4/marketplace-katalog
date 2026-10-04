import type { APIRoute } from 'astro';

import { siapkanDatabase } from '../lib/db';
import { ambilSatu } from '../lib/koneksi';

export const prerender = false;

/**
 * Healthcheck yang benar-benar berarti sesuatu.
 *
 * Sebelumnya halaman ini selalu membalas `ok` tanpa menyentuh apa pun, jadi
 * Docker menganggap container sehat walau database mati, tidak bisa dijalankan,
 * atau password-nya salah. Sekarang pemeriksaan ini ikut memegang satu query
 * database, jadi `docker ps` hanya menampilkan `healthy` kalau situs benar-benar
 * bisa melayani halaman.
 *
 * `siapkanDatabase()` ikut dipanggil supaya container yang baru start sempat
 * menyiapkan akun admin sebelum healthcheck pertama.
 */
export const GET: APIRoute = async () => {
  try {
    await siapkanDatabase();
    await ambilSatu('SELECT 1');
} catch (err) {
    // Balasan sengaja tidak memuat pesan error aslinya: driver's PostgreSQL
    // mencantumkan nama host, database, dan occasionally nama pengguna di
    // dalamnya, sementara /healthz dibaca oleh Docker dan pemantau uptime.
    // Penyebabnya dicetak ke log, yang hanya dilihat pemilik server.
    console.error('[healthz] Database tidak bisa dihubungi:', (err as Error).message);
    return new Response('db unavailable', { status: 503 });
  }
  return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
};