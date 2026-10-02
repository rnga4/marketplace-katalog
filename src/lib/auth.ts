import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { ambilSessionSecret, ambilPengguna, type Peran } from './db';

/**
 * Sesi tanpa server sesi terpisah: token berisi identitas, peran, dan
 * {csrf, kedaluwarsa} yang ditandatangani HMAC-SHA256 pakai SESSION_SECRET.
 * Cookie httpOnly + SameSite=Lax dipasang di sisi halaman.
 *
 * Ada dua cookie karena satu browser bisa jadi admin sekaligus seller.
 * Yang menentukan boleh atau tidak bukan cookie-nya, tapi peran di dalam
 * token, sehingga cookie seller tidak akan pernah diterima sebagai admin.
 */

const HARI = 24 * 60 * 60 * 1000;
export const COOKIE_ADMIN = 'hp_admin';
export const COOKIE_AKUN = 'hp_akun';
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

export interface Sesi {
  /** null hanya untuk token admin lama, dibuat sebelum id masuk ke token. */
  penggunaId: number | null;
  peran: Peran;
  csrf: string;
  /** Versi sesi pengguna saat token dibuat; token lama tidak berlaku setelah ganti sandi. */
  versi: number;
}

/** Token seller dan admin sama bentuknya; peran ikut di dalamnya. */
export function buatToken(
  penggunaId: number,
  peran: Peran,
  csrf: string,
  versi: number,
  ttlMs: number = LAMA_SESI,
): string {
  const payload = `${penggunaId}.${peran}.${csrf}.${Date.now() + ttlMs}.${versi}`;
  return `${Buffer.from(payload).toString('base64url')}.${tanda(payload)}`;
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
  const uji = Buffer.from(sig);
  const harapan = Buffer.from(tanda(payload));
  if (uji.length !== harapan.length || !timingSafeEqual(uji, harapan)) return null;

  const bagian = payload.split('.');

  // Token lama hanya berisi csrf + kedaluwarsa, tanpa identitas. Perlakukan
  // sebagai admin supaya sesi yang sedang dipakai tidak terlempar keluar saat
  // aplikasi diperbarui.
  if (bagian.length === 2) {
    const [csrf, expStr] = bagian;
    const exp = Number(expStr);
    if (!csrf || !Number.isFinite(exp) || exp < Date.now()) return null;
    return { penggunaId: null, peran: 'admin', csrf, versi: 0 };
  }

  // Token versi lama tidak membawa versi sesi; anggap 0 supaya tetap sah sampai
  // kata sandi diganti (yang menaikkan versi menjadi 1).
  if (bagian.length !== 4 && bagian.length !== 5) return null;
  const [idStr, peranStr, csrf, expStr, versiStr] = bagian;
  const penggunaId = Number(idStr);
  const exp = Number(expStr);
  const versi = versiStr === undefined ? 0 : Number(versiStr);
  if (!Number.isInteger(penggunaId) || penggunaId <= 0) return null;
  if (peranStr !== 'admin' && peranStr !== 'seller') return null;
  if (!csrf || !Number.isFinite(exp) || exp < Date.now()) return null;
  if (!Number.isInteger(versi) || versi < 0) return null;
  return { penggunaId, peran: peranStr, csrf, versi };
}

export interface PembacaCookie {
  get(name: string): { value: string | undefined } | undefined;
}

/**
 * Ambil sesi dari objek cookies Astro (Astro.cookies). Peran yang diminta
 * dicek di sini, jadi satu token tidak bisa dipakai di area lain.
 */
export function bacaSesi(
  cookies: PembacaCookie,
  cookie: string = COOKIE_ADMIN,
  peranDiminta: Peran = 'admin',
): Sesi | null {
  const sesi = cekToken(cookies.get(cookie)?.value);
  if (!sesi) return null;
  if (sesi.peran !== peranDiminta) return null;
  // Token lama tanpa id tidak punya versi; biarkan sampai kedaluwarsa.
  if (sesi.penggunaId !== null) {
    const pengguna = ambilPengguna(sesi.penggunaId);
    if (!pengguna || pengguna.sesiVersi !== sesi.versi) return null;
  }
  return sesi;
}