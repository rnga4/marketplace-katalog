import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { ambilSessionSecret } from './db';

/**
 * Sesi admin tanpa server sesi terpisah: token berisi {csrf, kedaluwarsa}
 * yang ditandatangani HMAC-SHA256 pakai SESSION_SECRET.
 * Cookie httpOnly + SameSite=Lax dipasang di sisi halaman.
 */

const HARI = 24 * 60 * 60 * 1000;
export const COOKIE_ADMIN = 'hp_admin';
export const LAMA_SESI = 7 * HARI;

function tanda(data: string): string {
  return createHmac('sha256', ambilSessionSecret()).update(data).digest('hex');
}

export function cookieAman(req: Request, url: URL): boolean {
  return url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
}

export function buatCsrf(): string {
  return randomBytes(16).toString('hex');
}

export function buatToken(csrf: string, ttlMs: number = LAMA_SESI): string {
  const payload = `${csrf}.${Date.now() + ttlMs}`;
  return `${Buffer.from(payload).toString('base64url')}.${tanda(payload)}`;
}

export interface Sesi {
  csrf: string;
}

export function cekToken(token: string | undefined): Sesi | null {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [csrf, expStr] = payload.split('.');
  const exp = Number(expStr);
  if (!csrf || !Number.isFinite(exp) || exp < Date.now()) return null;
  const uji = Buffer.from(sig);
  const harapan = Buffer.from(tanda(payload));
  if (uji.length !== harapan.length || !timingSafeEqual(uji, harapan)) return null;
  return { csrf };
}

/** Ambil sesi dari objek cookies Astro (Astro.cookies). */
export function bacaSesi(cookies: {
  get(name: string): { value: string | undefined } | undefined;
}): Sesi | null {
  const token = cookies.get(COOKIE_ADMIN)?.value;
  return cekToken(token);
}