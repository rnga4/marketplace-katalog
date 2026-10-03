import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rupiah,
  angkaRibuan,
  gabung,
  satuan,
  kapital,
  namaVt,
  rupiahRingkas,
} from '../src/lib/format.ts';
import { normalisasiWa, waValid, inisial, linkWa } from '../src/data/site.ts';
import {
  teksForm,
  daftarForm,
  checkboxOn,
  angkaForm,
  angkaAtauNull,
  slugValid,
} from '../src/lib/forms.ts';

test('rupiah dan angkaRibuan memakai format ribuan Indonesia', () => {
  assert.match(rupiah(1_500_000), /1\.500\.000/);
  assert.equal(angkaRibuan(1_500_000), '1.500.000');
  assert.equal(angkaRibuan(null), '');
  assert.equal(angkaRibuan(undefined), '');
});

test('gabung membuang bagian kosong tanpa pemisah yatim', () => {
  assert.equal(gabung(['A', '', null, undefined, 'B']), 'A · B');
  assert.equal(gabung([]), '');
  assert.equal(gabung(['', '   ']), '');
});

test('satuan menempelkan satuan hanya ke angka polos', () => {
  assert.equal(satuan('8', 'GB'), '8 GB');
  assert.equal(satuan('8 GB', 'GB'), '8 GB');
  assert.equal(satuan('6,5', 'inci'), '6,5 inci');
  assert.equal(satuan('', 'GB'), '');
});

test('kapital dan namaVt', () => {
  assert.equal(kapital('pixel'), 'Pixel');
  assert.equal(kapital(''), '');
  assert.equal(namaVt('pixel-3'), 'foto-pixel-3-1cin56v');
  assert.equal(namaVt('a/b..c'), 'foto-abc-1ty1zme');
  assert.notEqual(namaVt('a/b'), namaVt('ab'));
});

test('rupiahRingkas menyusun juta dan rb', () => {
  assert.equal(rupiahRingkas(2_000_000), 'Rp2 juta');
  assert.equal(rupiahRingkas(1_500_000), 'Rp1,5 juta');
  assert.equal(rupiahRingkas(500_000), 'Rp500 rb');
});

test('normalisasiWa menormalkan nol depan dan kode negara', () => {
  assert.equal(normalisasiWa('0812-3456-7890'), '6281234567890');
  assert.equal(normalisasiWa('62 812 3456 7890'), '6281234567890');
  assert.equal(normalisasiWa('00628'), '628');
  assert.equal(normalisasiWa('81234567890'), '6281234567890');
  assert.equal(normalisasiWa(''), '');
  assert.equal(normalisasiWa('000'), '');
});

test('waValid menuntut format 62 yang sudah dinormalkan', () => {
  assert.equal(waValid('6281234567890'), true);
  assert.equal(waValid('081234567890'), false);
  assert.equal(waValid('62'), false);
  assert.equal(waValid(''), false);
});

test('inisial menurun dari nama toko', () => {
  assert.equal(inisial('Kiruya Shop'), 'KS');
  assert.equal(inisial('clothglitch'), 'CL');
  assert.equal(inisial('Toko'), 'TO');
  assert.equal(inisial(''), '?');
});

test('linkWa null saat nomor tidak sah', () => {
  assert.match(linkWa(undefined, '6281234567890', 'Toko') ?? '', /^https:\/\/wa\.me\/6281234567890\?text=/);
  assert.equal(linkWa(undefined, '', 'Toko'), null);
  assert.equal(linkWa(undefined, '081234567890', 'Toko'), null);
});

test('teksForm dan daftarForm membersihkan isi', () => {
  const fd = new FormData();
  fd.set('nama', '  Pixel 3  ');
  fd.set('daftar', '\n satu \n\n dua \n');
  assert.equal(teksForm(fd, 'nama'), 'Pixel 3');
  assert.equal(teksForm(fd, 'tidakada'), '');
  assert.deepEqual(daftarForm(fd, 'daftar'), ['satu', 'dua']);
});

test('checkboxOn hanya "on" yang dianggap dicentang', () => {
  const fd = new FormData();
  fd.set('aktif', 'on');
  fd.set('mati', 'off');
  assert.equal(checkboxOn(fd, 'aktif'), true);
  assert.equal(checkboxOn(fd, 'mati'), false);
  assert.equal(checkboxOn(fd, 'tidakada'), false);
});

test('angkaForm dan angkaAtauNull membaca angka bertitik', () => {
  const fd = new FormData();
  fd.set('harga', 'Rp 1.500.000');
  fd.set('nol', '0');
  fd.set('kosong', '');
  assert.equal(angkaForm(fd, 'harga'), 1_500_000);
  assert.equal(angkaForm(fd, 'kosong'), 0);
  assert.equal(angkaAtauNull(fd, 'nol'), null);
  assert.equal(angkaAtauNull(fd, 'kosong'), null);
  assert.equal(angkaAtauNull(fd, 'harga'), 1_500_000);
});

test('slugValid menolak bentuk yang tidak aman', () => {
  assert.equal(slugValid('pixel-3'), true);
  assert.equal(slugValid('a'), true);
  assert.equal(slugValid('a'.repeat(80)), true);
  assert.equal(slugValid('a'.repeat(81)), false);
  assert.equal(slugValid('-abc'), false);
  assert.equal(slugValid('abc-'), false);
  assert.equal(slugValid('Abc'), false);
  assert.equal(slugValid('../etc'), false);
  assert.equal(slugValid('a b'), false);
  assert.equal(slugValid(''), false);
});
