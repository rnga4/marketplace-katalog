# Katalog HP Bekas + Panel Admin

Katalog HP bekas pribadi dengan panel admin untuk mengelola unit. Astro 7 (SSR) + Tailwind CSS 4 + SQLite, jalan lewat Docker di `http://localhost:8096`.

Sisi pembeli: katalog publik dengan daftar unit dan halaman detail per unit.
Sisi penjual: panel admin ber-login untuk menambah, mengubah, menandai terjual, dan menghapus unit.

## Menjalankan

```bash
docker compose up -d --build
docker compose logs app      # cek kata sandi admin awal
```

Buka `http://localhost:8096`. Panel admin ada di `/admin`.

Data disimpan di `./data` (SQLite + foto), tidak hilang saat container dibangun ulang. Hapus folder itu untuk mulai dari nol.

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
| `/admin` | Daftar unit: tandai terjual, edit, hapus (dua langkah). |
| `/admin/tambah` | Form unit baru. Slug otomatis dari nama. |
| `/admin/edit/[slug]` | Form unit yang sama, terisi data lama. |
| `/admin/pengaturan` | Identitas toko: nama, nama lengkap, tagline, WhatsApp, lokasi, deskripsi. |
| `/admin/ubah-sandi` | Ganti kata sandi, minta sandi lama. |

Alur katalog publik: `/` daftar unit, `/hp/<slug>` detail, `/sitemap.xml` untuk mesin pencari. Semua dirender dari database, jadi unit yang baru ditambah langsung muncul tanpa build ulang.

## Identitas toko

Nama, nama lengkap, tagline, lokasi, deskripsi, dan nomor WhatsApp diisi lewat `/admin/pengaturan`, lalu dipakai ulang di header, footer, judul halaman, dan tombol WhatsApp. Nilainya disimpan di tabel `pengaturan` (satu baris JSON, kunci `identitas`) sehingga **berubah tanpa build ulang**.

Nomor WhatsApp ditulis boleh `08xx` atau `+62xx`, disimpan otomatis jadi format `62xx`. Kalau dikosongkan, semua tombol WhatsApp hilang dari halaman publik — bukan replaced dengan nomor asal. Kotak logo di header memakai inisial nama, jadi berubah sendiri mengikuti nama yang diisi.

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
  lib/db.ts        SQLite: skema, benih, CRUD, hash sandi
  lib/auth.ts      token sesi (HMAC) dan CSRF
  lib/forms.ts     pembaca form + teks notifikasi
  lib/formUnit.ts  pemetaan FormData → unit, proses unggah foto
  lib/foto.ts      varian WebP 1600/1000/400, srcset, deteksi HEIC
  middleware.ts    gerbang /admin
  pages/admin/     login, daftar, tambah, edit, pengaturan, ubah sandi, logout
  pages/hp/        detail unit
docker/
  entrypoint.sh    siapkan folder, seed foto, jalankan sebagai user node
nginx/web/         aset statis + foto dari volume, sisanya proxy ke app
```

## Batasan yang perlu diketahui

- **SQLite bawaan Node masih eksperimental.** Node 22 mencetak `ExperimentalWarning` saat boot. Fungsinya stabil untuk pemakaian ini, tapi jangan dipakai untuk akses bersamaan yang ramai.
- **Tidak ada upload banyak file lewat tombol terpisah.** Foto dipilih lewat input file lalu langsung masuk ke daftar; seller biasanya 2-4 foto per unit.
- **Foto dihapus dari DB saat unit dihapus, file-nya tidak.** Ini disengaja supaya salah hapus tidak langsung hilang fotonya. Kebersihan manual pakai `rm` di `data/foto`.
- **Satu admin, satu kata sandi.** Tidak ada multi-akun atau riwayat siapa mengubah apa. Untuk katalog pribadi ini cukup; kalau nanti butuh lebih dari satu orang, itu fitur baru, bukan penyetelan.
- **Panel terbuka lewat jaringan lokal.** Kalau mau diakses dari luar, pakai profil tunnel (`docker compose --profile tunnel up -d`) dan isi identitas lewat `/admin/pengaturan` dulu.

## Yang perlu diisi sebelum go-live

Semua identitas toko sekarang bisa diisi dari panel, jadi tidak ada file yang perlu diedit dan tidak perlu rebuild:

- Buka `/admin/pengaturan`, isi **nama toko** dan **nomor WhatsApp** yang asli. Tanpa nomor, semua tombol WhatsApp di halaman publik disembunyikan, jadi pembeli tidak bisa menghubungi.
- Ganti foto placeholder bertanda "FOTO CONTOH" dengan foto unit asli lewat `/admin/tambah` atau `/admin/edit`. Foto placeholder sengaja dibiarkan kelihatan sampai diganti, supaya tidak ada foto palsu yang dipakai menjual.
- Logo: kotak header masih inisial nama. Kalau toko sudah punya logo, bilang saja untuk dipasang.

`DESIGN.md` juga menandai arah visualnya sebagai draf yang dirangkum agent, belum disetujui pemilik. Isi bagian Identitas dan Palet kalau toko sudah punya warna dan nama sendiri, lalu sesuaikan komponennya.
