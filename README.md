# Marketplace Katalog HP Bekas

Katalog HP bekas dengan banyak penjual: ada toko katalog utama, dan seller bisa mendaftar sendiri lalu memasang unit di lapaknya. Astro (SSR) + Tailwind CSS 4 + SQLite, jalan lewat Docker di `http://localhost:8096`.

Sisi pembeli: katalog publik dengan pencarian, filter penjual, dan halaman detail per unit. Halaman detail dan halaman lapak seller ada supaya pembeli tahu siapa yang menjual.
Sisi penjual: daftar di `/daftar`, kelola unit sendiri di `/akun`. Tidak ada keranjang dan tidak ada pesanan; pembeli menghubungi penjual lewat WhatsApp.
Sisi admin: panel ber-login untuk mengelola katalog utama sekaligus meninjau produk seller.

## Menjalankan

```bash
docker compose up -d --build
docker compose logs app      # cek kata sandi admin awal
```

Buka `http://localhost:8096`. Panel admin ada di `/admin`.

Data disimpan di `./data` (SQLite + foto), tidak hilang saat container dibangun ulang. Hapus folder itu untuk mulai dari nol.

Dua image dibangun dari sumber yang sama, dan keduanya harus ikut rebuild setelah perubahan CSS atau frontmatter: `app` menjalankan SSR-nya, `web` menyimpan berkas statis hasil build. Kalau hanya `app` yang dibangun ulang, halaman merujuk nama CSS baru sementara nginx masih melayani CSS lama, dan hasilnya 404 tanpa style — layout tandanya nav yang tidak lagi tersembunyi. Karena itu tetap pakai `docker compose up -d --build`, yang membangun keduanya.

## Kata sandi admin

Kalau `ADMIN_PASSWORD` tidak diisi di `.env`, kata sandi acak dibuat saat database pertama kali dibuat dan dicetak sekali di log:

```bash
docker compose logs app | grep -A1 "sandi awal"
```

Untuk menetapkan sendiri, salin `.env.example` ke `.env` lalu isi `ADMIN_PASSWORD`, lalu `docker compose up -d`. Password tersimpan sebagai hash scrypt di database, jadi mengganti `ADMIN_PASSWORD` di `.env` tidak menimpa password yang sudah diganti lewat panel. Panel "Ubah kata sandi" meminta sandi lama sebagai konfirmasi.

## Isi katalog

`src/data/hp.json` hanya jadi **benih**. Database kosong akan diisi dari file ini saat boot pertama, 4 unit contoh. Setelah itu katalog dikelola lewat panel admin, dan perubahan tidak perlu rebuild.

Foto di `seed-foto/` adalah placeholder bertanda "FOTO CONTOH" yang dipakai untuk mengisi folder foto saat masih kosong. Ganti lewat unggah di panel admin.

## Panel admin

| Halaman | Isi |
|---|---|
| `/admin/login` | Login. Sesi 7 hari, cookie `httpOnly`. |
| `/admin` | Daftar semua unit, termasuk milik seller. Tandai terjual, edit, hapus (dua langkah). |
| `/admin/moderasi` | Antrean review produk seller. Tab menunggu / tayang / ditolak. |
| `/admin/tambah` | Form unit baru. Slug otomatis dari nama. |
| `/admin/edit/[slug]` | Form unit yang sama, terisi data lama. |
| `/admin/pengaturan` | Identitas toko: nama, nama lengkap, tagline, WhatsApp, lokasi, deskripsi. |
| `/admin/ubah-sandi` | Ganti kata sandi, minta sandi lama. |

Alur katalog publik: `/` daftar unit dengan pencarian dan filter, `/hp/<slug>` detail, `/lapak/<slug>` halaman lapak seller, `/sitemap.xml` untuk mesin pencari. Semua dirender dari database, jadi unit yang baru ditambah langsung muncul tanpa build ulang.

## Penjual (seller)

| Halaman | Isi |
|---|---|
| `/daftar` | Bikin akun seller dan lapak pertama sekaligus. Identitasnya nama toko, nomor WhatsApp, dan kata sandi. |
| `/masuk` | Login seller pakai nomor WhatsApp. Sesi 7 hari, cookie `httpOnly` terpisah dari admin. |
| `/akun` | Unit milik seller itu sendiri, dengan status moderasi tiap unit. |
| `/akun/tambah` | Tambah unit. Langsung masuk antrean review. |
| `/akun/edit/[slug]` | Edit unit milik sendiri. |
| `/akun/toko` | Ubah nama lapak, nomor WhatsApp, deskripsi, lokasi, dan kata sandi. |
| `/lapak/<slug>` | Halaman publik lapak itu, hanya berisi unit yang sudah tayang. |

Aturan yang tidak bisa dilanggar seller:

- Satu akun satu lapak. Kalau perlu lapak kedua, itu fitur baru, bukan pengaturan.
- Seller hanya melihat dan mengubah unitnya sendiri. Edit dan hapus mengecek kepemilikan, dan nama file foto dibatasi supaya seller tidak bisa memasang foto milik orang lain.
- Produk baru tidak langsung tayang. Admin menerimanya di `/admin/moderasi`. Produk yang ditolak tampil di `/akun` lengkap dengan alasannya, dan setiap edit mengembalikannya ke antrean.
- Nomor WhatsApp tiap seller dipakai hanya untuk unitnya. Kalau belum diisi, tombol WhatsApp disembunyikan; nomornya tidak pernah jatuh ke nomor toko utama.

## Moderasi

Status unit seller: `menunggu` (baru dikirim), `tayang` (sudah diizinkan), `tolak` (ditolak dengan alasan). Status ini tidak bisa dikirim lewat form, `db.ts` yang menurunkannya dari siapa pemilik unitnya.

Produk yang ditolak atau ditarik hilang dari katalog, sitemap, halaman detail, dan redirect `/go/<slug>`. Admin yang mengedit unit seller juga mengembalikannya ke antrean, supaya perubahan tidak lolos tanpa review.

Nomor WhatsApp seller tidak bisa tetap kosong diam-diam: produk yang tayang tanpa nomor seller akan tampil di katalog tanpa tombol WhatsApp sama sekali, jadi pembeli tidak bisa menghubungi. Isi nomornya di `/akun/toko` supaya produknya punya tombol.

## Identitas toko

Nama, nama lengkap, tagline, lokasi, deskripsi, dan nomor WhatsApp diisi lewat `/admin/pengaturan`, lalu dipakai ulang di header, footer, judul halaman, dan tombol WhatsApp. Nilainya disimpan di tabel `pengaturan` (satu baris JSON, kunci `identitas`) sehingga **berubah tanpa build ulang**.

Nomor WhatsApp ditulis boleh `08xx` atau `+62xx`, disimpan otomatis jadi format `62xx`. Kalau dikosongkan, semua tombol WhatsApp hilang dari halaman publik — bukan diganti dengan nomor asal. Kotak logo di header memakai inisial nama, jadi berubah sendiri mengikuti nama yang diisi.

Nilai bawaan ada di `src/data/site.ts` dan hanya dipakai selama identitas belum pernah disimpan.

## Foto

Foto yang diunggah diproses server memakai `sharp`: EXIF orientation dibenerkan, lalu disimpan sebagai tiga varian WebP — 1600px (disimpan di DB), 1000px (`-m.webp`), dan 400px (`-t.webp`). Database hanya menyimpan nama file besar.

Halaman detail dan katalog memakai `srcset`/`sizes`, jadi browser mengunduh varian yang paling sesuai layarnya. rata-rata halaman detail turun dari sekitar 4.4 MB menjadi 86 KB di ponsel untuk foto 7.7 MB, atau 8x lebih ringan di layar lebar.

Batas unggah lewat Nginx 120 MB untuk total satu pengiriman. Kalau terlampaui, tampil halaman penjelasan (bukan 413 kosong) yang menyarankan mengirim foto satu per satu atau perkecil dulu.

Folder foto hanya diisi dari `seed-foto/` saat masih kosong, jadi 30 varian placeholder ikut terpasang di server yang sudah punya data.

## Keamanan

- Kata sandi di-hash scrypt (bawaan Node, tanpa dependency)
- Sesi ditandatangani HMAC; `SESSION_SECRET` dibuat otomatis dan disimpan di `data/.secret`
- Proteksi CSRF: token di setiap form, diverifikasi terhadap sesi, plus `checkOrigin` bawaan Astro
- Login gagal diberi jeda 450 ms
- Halaman admin `noindex, nofollow`; `robots.txt` menutup `/admin`
- Panel aplikasi berjalan sebagai user `node` (bukan root); volume foto di Nginx dipasang read-only

## Struktur

```
src/
  lib/db.ts        SQLite: skema, pengguna/lapak, katalog, moderasi, hash sandi
  lib/auth.ts      token sesi (HMAC) dengan peran, cookie admin/seller, CSRF
  lib/ratelimit.ts penguncian login berbasis SQLite
  lib/forms.ts     pembaca form + teks notifikasi
  lib/formUnit.ts  pemetaan FormData → unit, proses unggah foto, saring nama foto
  lib/foto.ts      varian WebP 1600/1000/400, srcset, deteksi HEIC
  middleware.ts    gerbang /admin dan /akun
  components/      kartu unit, paginasi, navigasi bawah, tombol kembali
  layouts/         BaseLayout (publik), AdminLayout, AkunLayout
  pages/admin/     login, daftar unit, moderasi, tambah, edit, pengaturan, ubah sandi
  pages/akun/      dashboard seller: unit, tambah, edit, toko, hapus, keluar
  pages/hp/        detail unit
  pages/lapak/     halaman publik lapak seller
  pages/go/        redirect WhatsApp per unit
docker/
  entrypoint.sh    siapkan folder, seed foto, jalankan sebagai user node
nginx/web/         aset statis + foto dari volume, sisanya proxy ke app
```

## Batasan yang perlu diketahui

- **SQLite bawaan Node masih eksperimental.** Node 22 mencetak `ExperimentalWarning` saat boot. Fungsinya stabil untuk pemakaian ini, tapi jangan dipakai untuk akses bersamaan yang ramai.
- **Tidak ada upload banyak file lewat tombol terpisah.** Foto dipilih lewat input file lalu langsung masuk ke daftar; seller biasanya 2-4 foto per unit.
- **Foto dihapus dari DB saat unit dihapus, file-nya tidak.** Ini disengaja supaya salah hapus tidak langsung hilang fotonya. Kebersihan manual pakai `rm` di `data/foto`.
- **Satu admin, satu kata sandi.** Peran admin belum bisa di luar satu orang: kata sandinya tunggal dan belum ada daftar siapa mengubah apa. Multi-seller sudah ada, multi-admin belum.
- **Panel terbuka lewat jaringan lokal.** Kalau mau diakses dari luar, pakai profil tunnel (`docker compose --profile tunnel up -d`) dan isi identitas lewat `/admin/pengaturan` dulu.
- **Seller tidak diverifikasi KTP, dan nomornya adalah satu-satunya jalan kembali ke akun.** Akun langsung aktif setelah daftar. Konsekuensinya harus jelas: kalau seller kehilangan nomor WhatsApp-nya, akunnya tidak bisa dipulihkan, karena tidak ada email dan tidak ada tombol reset kata sandi. Buat tahap katalog ini cukup, tapi ini alasan verificação email atau KTP belum bisa ditunda selamanya.
- **Nomor WhatsApp adalah identitas login, jadi satu nomor satu akun.** Nomor yang sama adalah cara paling murah untuk mengambil alih lapak orang lain, jadi pendaftaran menolaknya. Nomor untuk masuk tidak bisa diganti sendiri di panel; kalau seller ganti nomor kontak di `/akun/toko`, nomor masuknya tetap yang lama.

## Yang perlu diisi sebelum go-live

Semua identitas toko sekarang bisa diisi dari panel, jadi tidak ada file yang perlu diedit dan tidak perlu rebuild:

- Buka `/admin/pengaturan`, isi **nama toko** dan **nomor WhatsApp** yang asli. Tanpa nomor, semua tombol WhatsApp di halaman publik disembunyikan, jadi pembeli tidak bisa menghubungi.
- Ganti foto placeholder bertanda "FOTO CONTOH" dengan foto unit asli lewat `/admin/tambah` atau `/admin/edit`. Foto placeholder sengaja dibiarkan kelihatan sampai diganti, supaya tidak ada foto palsu yang dipakai menjual.
- Logo: kotak header masih inisial nama. Kalau toko sudah punya logo, bilang saja untuk dipasang.
- Kalau mau menerima seller dari publik, buka pendaftaran. Sampai itu, `/daftar` sudah hidup tapi tidak ditautkan dari mana pun, jadi pembeli tidak tersesat ke sana tanpa sengaja. Satu nomor hanya bisa mendaftar satu toko, jadi alasannya harus jelas ke calon seller.

`DESIGN.md` sudah berstatus ketetapan, bukan draf. Kalau nanti mau mengubah arah visual, baca bagian Identitas, Palet, Motif, dan bagian "Multi-seller: batas yang sudah diputuskan" dulu — perubahan di sana mengikat komponen dan perilakunya.
