/**
 * Uji lapis data terhadap Postgres sungguhan.
 *
 * `astro check` hanya memastikan tipenya cocok. Placeholder yang salah nomor,
 * `COUNT(*)` yang tiba-tiba jadi string, atau `BIGINT` yang lolos sebagai
 * `undefined` tidak akan ketahuan di situ — semuanya baru muncul ketika query
 * benar-benar dijalankan.
 *
 * Jalankan:
 *   DATABASE_URL='postgres://hpsecond:...@host:5432/hpsecond' \
 *     node_modules/.bin/jiti scripts/uji-db.ts
 *
 * Skrip ini menulis ke database yang ditunjuk DATABASE_URL, lalu menghapus
 * kembali baris yang dibuatnya sendiri. Jangan arahkan ke database produksi.
 */
import { strict as assert } from 'node:assert';

import {
  ambilAdmin,
  ambilLapak,
  ambilPengumuman,
  ambilSessionSecret,
  ambilSite,
  createPengguna,
  catatKlik,
  cekKataSandi,
  createUnit,
  deleteUnit,
  getUnit,
  hapusKlik,
  hapusPengumuman,
  hitungKlik,
  katalogUnit,
  listAntrean,
  listLapakTayang,
  listLapakTersedia,
  listSemuaUnits,
  listUnits,
  pastikanAdmin,
  setModerasi,
  setPengumumanAktif,
  setTersedia,
  simpanLapak,
  simpanPengumuman,
  simpanSite,
  setKataSandi,
} from '../src/lib/db';
import { ambilSatu, ubahBaris } from '../src/lib/koneksi';
import { bersihkan, catatGagal, terkunci } from '../src/lib/ratelimit';

const stempel = Date.now().toString(36);
const nomorUji = `+62899${String(Date.now()).slice(-9)}`;
const slugUji = `uji-${stempel}`;

// Nama toko unik tiap kali tes dijalankan: slugLapak() menambah akhiran angka
// kalau slug-nya sudah dipakai, jadi nama tetap harus dibedakan tiap invocation.
const namaLapakUji = `Toko Lapak Uji ${stempel}`;
const slugLapakUji = `toko-lapak-uji-${stempel}`;

let lulus = 0;
const gagal: string[] = [];

async function cek(nama: string, f: () => Promise<void> | void): Promise<void> {
  try {
    await f();
    lulus += 1;
    console.log(`  ok    ${nama}`);
  } catch (err) {
    // assert dari node menyetoruga baris 'expected/actual' di baris berikutnya,
    // jadi pesan dipotong 4 baris supaya perbedaannya kelihatan.
    const pesan = (err as Error).message.split('\n').slice(0, 5).join(' | ');
    console.log(`  GAGAL ${nama}`);
    console.log(`        ${pesan}`);
    gagal.push(`${nama} — ${pesan}`);
  }
}

/* ----- helper koneksi ----- */

console.log('\n== helper koneksi ==');

await cek('ubahBaris mengonversi placeholder ? menjadi $n', async () => {
  const id = await ambilSatu<{ id: number }>(
    'INSERT INTO pengumuman (judul, isi, aktif, dibuat_pada, diubah_pada) VALUES (?, ?, ?, ?, ?) RETURNING id',
    ['uji helper', 'x', true, Date.now(), Date.now()],
  );
  assert.ok(id, 'pengumuman uji gagal dibuat');
  assert.equal(await ubahBaris('UPDATE pengumuman SET judul = ? WHERE id = ?', ['ubah', id.id]), 1);
  assert.equal(await ubahBaris('DELETE FROM pengumuman WHERE id = ?', [id.id]), 1);
});

await cek('ubahBaris mengembalikan 0 saat tidak ada baris yang cocok', async () => {
  assert.equal(await ubahBaris('DELETE FROM pengumuman WHERE id = ?', [999_999_999]), 0);
});

/* ----- rate limit ----- */

console.log('\n== rate limit (uji penomoran placeholder) ==');

await cek('terkunci setelah 5 kegagalan, lalu bebas setelah bersihkan', async () => {
  const kunci = [`uji:ip:${stempel}`] as const;
  assert.equal(await terkunci(kunci), false, 'kunci baru belum boleh terkunci');
  for (let i = 0; i < 5; i += 1) await catatGagal(kunci);
  assert.equal(await terkunci(kunci), true, 'harus terkunci setelah 5 kegagalan');

  const baris = await ambilSatu<{ n: number; buka: string }>(
    'SELECT n, buka FROM percobaan WHERE kunci = ?',
    [kunci[0]],
  );
  assert.equal(baris?.n, 5, `penghitung harus 5, dapat ${baris?.n}`);
  assert.ok(Number(baris?.buka) > Date.now(), 'buka harus masih di masa depan');

  await bersihkan(kunci);
  assert.equal(await terkunci(kunci), false, 'harus bebas setelah dibersihkan');
});

await cek('window yang sudah lewat mengulang penghitung dari 1', async () => {
  const kunci = [`uji:kedaluwarsa:${stempel}`] as const;
  for (let i = 0; i < 5; i += 1) await catatGagal(kunci);
  assert.equal(await terkunci(kunci), true);
  // Mundurkan `buka` ke masa lalu: jendela lama harus kedaluwarsa, penghitung
  // mulai dari 1 lagi, bukan 6.
  await ubahBaris('UPDATE percobaan SET buka = ? WHERE kunci = ?', [Date.now() - 1000, kunci[0]]);
  assert.equal(await terkunci(kunci), false);
  await catatGagal(kunci);
  const baris = await ambilSatu<{ n: number }>('SELECT n FROM percobaan WHERE kunci = ?', [kunci[0]]);
  assert.equal(baris?.n, 1, `penghitung harus reset ke 1, dapat ${baris?.n}`);
  await bersihkan(kunci);
});

/* ----- session secret ----- */

console.log('\n== session secret ==');

await cek('nilai sama antar pemanggilan dan cukup panjang', async () => {
  const a = await ambilSessionSecret();
  const b = await ambilSessionSecret();
  assert.equal(a, b, 'secret harus sama, kalau tidak semua cookie jadi tidak terbaca');
  assert.ok(a.length >= 32, `secret terlalu pendek: ${a.length} karakter`);
});

/* ----- unit ----- */

let idPenggunaUji = 0;
let idPenggunaLapak = 0;

console.log('\n== pengguna ==');

await cek('createPengguna menyimpan akun yang bisa diverifikasi', async () => {
  const p = await createPengguna({
    nomor: nomorUji,
    nama: 'Seller Uji',
    kataSandi: 'rahasia-uji-123',
    peran: 'seller',
  });
  idPenggunaUji = p.id;
  assert.ok(p.id > 0, 'id pengguna harus terisi');
  // normalisasiWa melepas tanda '+' dan menyimpan bentuk 62xxx, sama seperti
  // versi SQLite. Yang penting bentuknya konsisten supaya satu nomor selalu
  // berarti satu akun.
  assert.equal(p.nomor, nomorUji.replace('+', ''), `nomor harus ternormalisasi, dapat "${p.nomor}"`);
});

await cek('satu nomor tidak bisa dipakai dua akun', async () => {
  await assert.rejects(
    () => createPengguna({ nomor: nomorUji, nama: 'Duplikat', kataSandi: 'x', peran: 'seller' }),
    /sudah dipakai/,
    'nomor ganda harus ditolak',
  );
});

console.log('\n== unit: tulis dan baca ==');

await cek('createUnit tersimpan lengkap', async () => {
  const unit = await createUnit(slugUji, {
    nama: 'Unit Uji Otomatis',
    merk: 'Xiaomi',
    seri: 'Redmi Note 11',
    ram: '6 GB',
    kapasitas: '128 GB',
    warna: 'Abu-abu',
    kondisi: 'mulus',
    harga: 2_500_000,
    hargaAsli: 3_100_000,
    tersedia: true,
    tahunRilis: 2022,
    layar: '6.43 inch AMOLED',
    baterai: '5000 mAh',
    kelengkapan: ['Dus', 'Charger'],
    catatan: ['Unit uji'],
    deskripsi: 'Dibuat oleh skrip uji.',
    foto: [],
    pemilikId: idPenggunaUji,
  });
  assert.equal(unit.slug, slugUji, 'slug harus persis seperti yang diminta');
  assert.equal(unit.kondisi, 'mulus', 'kondisi harus kembali sebagai union Kondisi');
});

await cek('getUnit mengembalikan angka dan boolean yang benar', async () => {
  const u = await getUnit(slugUji);
  assert.ok(u, 'unit harus ditemukan');
  assert.equal(u!.harga, 2_500_000, `harga harus number, dapat ${typeof u!.harga}`);
  assert.equal(u!.hargaAsli, 3_100_000, 'hargaAsli harus utuh');
  assert.equal(u!.tahunRilis, 2022, 'tahunRilis harus number');
  assert.strictEqual(u!.tersedia, true, 'tersedia harus boolean true, bukan 1');
  assert.deepEqual(u!.kelengkapan, ['Dus', 'Charger'], 'kelengkapan harus kembali sebagai array');
  assert.strictEqual(u!.pemilikId, idPenggunaUji, 'pemilikId harus kembali sebagai number');
});

await cek('unit seller baru menunggu moderasi', async () => {
  const u = await getUnit(slugUji);
  assert.equal(u!.moderasi, 'menunggu', `harus menunggu, dapat "${u!.moderasi}"`);
});

await cek('setTersedia menyimpan boolean, bukan 0/1', async () => {
  await setTersedia(slugUji, false);
  assert.strictEqual((await getUnit(slugUji))!.tersedia, false, 'harus false');
  await setTersedia(slugUji, true);
  assert.strictEqual((await getUnit(slugUji))!.tersedia, true, 'harus true kembali');
});

await cek('unit tayang muncul di listUnits, yang menunggu tidak', async () => {
  assert.equal(
    (await listUnits()).some((u) => u.slug === slugUji),
    false,
    'unit menunggu tidak boleh muncul di katalog publik',
  );
  await setModerasi(slugUji, 'tayang');
  assert.equal(
    (await listUnits()).some((u) => u.slug === slugUji),
    true,
    'unit tayang harus muncul di katalog publik',
  );
});

await cek('listSemuaUnits memuat unit dari semua status', async () => {
  assert.equal(
    (await listSemuaUnits()).some((u) => u.slug === slugUji),
    true,
    'unit harus ada di daftar admin',
  );
});

await cek('listAntrean hanya memuat status yang diminta', async () => {
  const menunggu = await listAntrean('menunggu');
  assert.equal(
    menunggu.some((u) => u.slug === slugUji),
    false,
    'unit tayang tidak boleh ada di antrean menunggu',
  );
});

/* ----- katalog ----- */

console.log('\n== katalog ==');

await cek('pencarian tidak membedakan huruf besar-kecil', async () => {
  const hasil = await katalogUnit({ cari: 'REDMI' });
  assert.ok(hasil.unit.length > 0, 'pencarian huruf besar harus menemukan unit huruf kecil');
  assert.ok(
    hasil.unit.some((u) => u.slug === slugUji),
    `unit uji harus ditemukan, dapat ${hasil.unit.length} baris`,
  );
});

await cek('ESCAPE wildcard: "%" tidak boleh mengembalikan semua unit', async () => {
  const semua = await katalogUnit({ perHalaman: 96 });
  const joker = await katalogUnit({ cari: '%', perHalaman: 96 });
  assert.ok(
    joker.total < semua.total,
    `"%" seharusnya tidak mencocokkan semua baris (dapat ${joker.total} dari ${semua.total})`,
  );
});

await cek('ESCAPE wildcard: "_" tidak boleh mencocokkan semua unit', async () => {
  const semua = await katalogUnit({ perHalaman: 96 });
  const joker = await katalogUnit({ cari: '_', perHalaman: 96 });
  assert.ok(joker.total < semua.total, `"_" mencocokkan semua baris (${joker.total} dari ${semua.total})`);
});

await cek('total dan paginasi konsisten', async () => {
  const hasil = await katalogUnit({ perHalaman: 1 });
  assert.ok(hasil.unit.length <= 1, `perHalaman=1 harus maksimal 1 baris, dapat ${hasil.unit.length}`);
  assert.ok(hasil.total >= hasil.unit.length, 'total harus >= baris yang dikembalikan');
  assert.equal(
    hasil.jumlahHalaman,
    Math.ceil(hasil.total / 1),
    'jumlahHalaman harus ceil(total / perHalaman)',
  );
});

/* ----- lapak ----- */

console.log('\n== lapak ==');

await cek('simpanLapak lalu ambilLapak', async () => {
  // Lapak dipasang pada pemilik unit yang sama. Kalau tidak, join
  // `hp.pemilik_id = l.pengguna_id` memang tidak akan menemukan apa pun dan
  // tes ini hanya menguji kebetulan, bukan perilakunya.
  idPenggunaLapak = idPenggunaUji;
  const lapak = await simpanLapak(idPenggunaUji, {
    nama: namaLapakUji,
    deskripsi: 'Deskripsi uji.',
    whatsapp: '+6281234567890',
  });
  assert.equal(lapak.nama, namaLapakUji, 'nama toko harus kembali persis seperti dikirim');
  assert.equal(lapak.slug, slugLapakUji, `slug harus "${slugLapakUji}", dapat "${lapak.slug}"`);
  assert.equal(lapak.penggunaId, idPenggunaUji, 'lapak harus terikat ke pemiliknya');
  assert.ok((await ambilLapak(idPenggunaUji))?.nama, 'lapak harus bisa dibaca ulang');
});

await cek('satu pengguna tidak bisa punya dua lapak', async () => {
  await simpanLapak(idPenggunaUji, { nama: `Toko Kedua ${stempel}` });
  const back = await ambilLapak(idPenggunaUji);
  assert.equal(back?.slug, slugLapakUji, 'lapak pertama harus tetap utuh, bukan ditimpa');
});

await cek('listLapakTayang mengembalikan jumlah sebagai number', async () => {
  const semua = await listLapakTayang();
  const toko = semua.find((l) => l.slug === slugLapakUji);
  assert.ok(toko, 'lapak uji harus muncul di daftar tayang');
  assert.strictEqual(typeof toko!.jumlah, 'number', `jumlah harus number, dapat ${typeof toko!.jumlah}`);
  assert.ok(
    Number.isFinite(toko!.jumlah) && toko!.jumlah >= 1,
    `jumlah tidak masuk akal: ${JSON.stringify(toko!.jumlah)}`,
  );
  assert.strictEqual(typeof toko!.foto, 'string', 'foto harus string, bukan undefined');
});

await cek('perbandingan jumlah tidak salah karena string', async () => {
  // "10" > "9" bernilai false secara leksikografis. Kalau jumlah masih string,
  // filter "unit lebih dari 9" akan salah diam-diam.
  const semua = await listLapakTayang();
  for (const l of semua) {
    assert.ok(
      typeof l.jumlah === 'number',
      `jumlah lapak "${l.nama}" masih string: ${JSON.stringify(l.jumlah)}`,
    );
  }
});

await cek('listLapakTersedia hanya menghitung unit tersedia', async () => {
  const semua = await listLapakTersedia();
  const toko = semua.find((l) => l.slug === slugLapakUji);
  assert.ok(toko, 'lunya harus ada karena unitnya tayang dan tersedia');
  assert.strictEqual(toko!.jumlah, 1, `harus tepat 1, dapat ${toko!.jumlah}`);
});

/* ----- pengumuman ----- */

console.log('\n== pengumuman ==');

let idPengumuman = 0;

await cek('simpan, ubah status aktif, ambil, lalu hapus', async () => {
  const p = await simpanPengumuman({ judul: 'Uji pengumuman', isi: 'Isi uji.', aktif: true });
  idPengumuman = p.id;
  assert.ok(p.id > 0);
  assert.equal((await ambilPengumuman(p.id))?.judul, 'Uji pengumuman');
  await setPengumumanAktif(p.id, false);
  assert.equal((await ambilPengumuman(p.id))?.aktif, false, 'aktif harus boolean false');
  await hapusPengumuman(p.id);
  assert.equal(await ambilPengumuman(p.id), null, 'harus terhapus');
});

/* ----- pengaturan situs ----- */

console.log('\n== pengaturan situs ==');

await cek('simpanSite lalu ambilSite mengembalikan nilai baru', async () => {
  const lama = await ambilSite();
  await simpanSite({ ...lama, nama: 'Toko Uji Otomatis' });
  assert.equal((await ambilSite()).nama, 'Toko Uji Otomatis');
  await simpanSite(lama);
  assert.equal((await ambilSite()).nama, lama.nama, 'nama asli harus dipulihkan');
});

/* ----- admin ----- */

console.log('\n== admin ==');

await cek('pastikanAdmin mengembalikan akun admin yang ada', async () => {
  const admin = await pastikanAdmin();
  assert.equal(admin.peran, 'admin', `peran harus admin, dapat "${admin.peran}"`);
  assert.equal(admin.nomor, 'admin');
});

await cek('setKataSandi membuat kata sandi yang bisa diverifikasi', async () => {
  const sandi = `uji-admin-${stempel}`;
  await setKataSandi(sandi);
  assert.equal(await cekKataSandi(sandi), true, 'kata sandi yang baru disetel harus cocok');
  assert.equal(await cekKataSandi(`${sandi}-salah`), false, 'kata sandi salah harus ditolak');
  assert.ok(await ambilAdmin(), 'admin harus tetap bisa diambil');
});

/* ----- klik ----- */

console.log('\n== klik ==');

await cek('catatKlik menambah hitungan klik', async () => {
  const sebelum = (await hitungKlik(30))[slugUji] ?? 0;
  await catatKlik(slugUji);
  await catatKlik(slugUji);
  const sesudah = (await hitungKlik(30))[slugUji] ?? 0;
  assert.equal(sesudah, sebelum + 2, `harus bertambah 2 (${sebelum} → ${sesudah})`);
});

/* ----- hasil ----- */

console.log('\n== membersihkan data uji ==');
if (idPenggunaUji) await deleteUnit(slugUji);
await hapusKlik(slugUji);
await bersihkan([`uji:ip:${stempel}`, `uji:kedaluwarsa:${stempel}`]);
if (idPengumuman) await hapusPengumuman(idPengumuman);
// Lapak ikut dihapus: kolom pengguna_id di `lapak` dan `hp` memakai ON DELETE
// CASCADE, jadi pengguna uji bisa langsung dihapus tanpa meninggalkan sisa.
for (const id of [idPenggunaLapak, idPenggunaUji]) {
  if (id) await ubahBaris('DELETE FROM pengguna WHERE id = ?', [id]);
}
console.log(`  pengguna uji ${idPenggunaUji} dan ${idPenggunaLapak} dihapus`);

console.log(`\n${lulus} pemeriksaan lulus, ${gagal.length} gagal.`);
if (gagal.length) {
  console.log('\nYang gagal:');
  for (const g of gagal) console.log(`  - ${g}`);
  console.log('');
  process.exitCode = 1;
} else {
  console.log('Data uji sudah dibersihkan.\n');
}