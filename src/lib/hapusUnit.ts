import { getUnit, deleteUnit, hapusKlik } from './db';
import { hapusFoto } from './foto';

/**
 * Hapus unit beserta file foto dan riwayat kliknya dalam satu langkah. Dipakai
 * pemanggil di area admin dan seller supaya tidak ada yang lupa membersihkan
 * file atau baris statistik.
 */
export function hapusUnit(slug: string): void {
  const unit = getUnit(slug);
  if (!unit) return;
  for (const nama of unit.foto) hapusFoto(nama);
  deleteUnit(slug);
  hapusKlik(slug);
}
