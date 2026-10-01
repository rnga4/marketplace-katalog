# Rencana: katalog jadi multi-seller

Status: disetujui untuk dikerjakan bertahap. Setiap langkah diverifikasi sebelum lanjut.

Target: 1000 seller, satu lapak per seller, katalog saja (tanpa keranjang, pemesanan, atau pembayaran daring).

## Keputusan yang sudah dikunci

| Pertanyaan | Keputusan |
|---|---|
| Model | Satu akun = satu lapak. Setiap seller hanya boleh mengelola areanya sendiri. |
| Scope | Daftar, masuk, lapak per seller, moderasi produk. Tanpa keranjang, pesanan, alamat, dompet, rating. |
| Kontak pembeli | Tetap lewat WhatsApp, tapi nomornya milik seller, bukan nomor global. |
| Skala | 1000 seller dan 1000 lapak. |
| Credentials | Pemilik memegang sendiri kredensial. |

## Asumsi (bisa diubah sebelum ditulis ke data)

- **Moderasi wajib** sebelum produk tayang. Label "Terverifikasi" di setiap kartu adalah janji kualitas; moderasi adalah yang menjaganya.
- **Verifikasi email** saja untuk pendaftaran. Verifikasi identitas butuh layanan dari luar yang belum ada di proyek ini.
- **URL lapak** `/lapak/[slug-toko]`. Asumsi URL ini belum dipakai; katalog sekarang memakai `/hp/[slug]`.
- **Pembayaran manual** lewat WhatsApp di tahap 1.

## Kondisi kode sekarang

Tidak ada konsep pengguna sama sekali. "Daftar akun" berarti membangun lapisan identitas dari nol, jadi skema harus benar sejak awal karena ini yang mahal diubah belakangan.

- `src/lib/auth.ts:11` hanya satu `COOKIE_ADMIN`. Satu kata sandi untuk seluruh situs, tidak ada tabel pengguna.
- Tabel `hp` (`src/lib/db.ts:44`) tidak punya kolom pemilik. Unit yang ada sekarang tidak punya siapa.
- `pengaturan` menyimpan satu blob identitas toko (`src/lib/db.ts:345`). Satu `whatsapp` untuk semua.
- `listUnits()` (`src/lib/db.ts:151`) adalah `SELECT * FROM hp` tanpa `LIMIT`.
- Tombol WhatsApp di detail unit membaca dari identitas global (`src/data/site.ts:72`).

## Batas nyata di 1000 seller

| Komponen | Sekarang | Masalah di 1000 seller | Kapan |
|---|---|---|---|
| Database | SQLite, satu file (`db.ts:40`) | SQLite hanya satu penulis konkuren. Seller upload bersamaan memicu `SQLITE_BUSY`. | Tahap 2 |
| Foto | Disk lokal, dilayani nginx dari bind mount (`foto.ts:6`) | Satu server satu disk. Tidak ada backup, tidak ada CDN. Server mati berarti semua foto mati. | Tahap 2 |
| Rate limit | `Map` in-memory (`ratelimit.ts:1`) | Hilang saat restart, dan hanya berlaku untuk satu proses. | Tahap 2 |
| Katalog | `SELECT *` tanpa `LIMIT` (`db.ts:151`) | 10 ribu baris dimuat setiap request. | Tahap 1 |
| Sesi | Token HMAC stateless (`auth.ts:27`) | Sudah skalabel. Tidak diubah. | — |
| Slug produk | `slug` jadi primary key global | Dua seller bisa punya nama produk yang sama. | Tahap 1 |

---

## Tahap 1 — Multi-seller di SQLite

Tidak merusak apa pun yang berjalan sekarang. Data dan URL lama tetap utuh.

### 1.1 Skema dan migrasi

- Tabel `pengguna`: id, email (unik), nama, hash kata sandi, peran (`admin` atau `seller`), status, waktu dibuat.
- Tabel `lapak`: satu baris per pengguna, slug unik, nama toko, WhatsApp, deskripsi, lokasi.
- `hp` dapat kolom pemilik, status moderasi, dan alasan penolakan. Nullable, jadi unit lama tetap terbaca.
- Hash kata sandi memakai scrypt yang sudah ada di `setKataSandi` (`db.ts:288`), tidak menambah dependency.
- Akun admin pertama dibuat dari kredensial yang sudah ada, supaya `/admin` tidak mati setelah migrasi.
- Slug produk tetap unik global. Kalau bentrok, ditambah angka. Tidak mengubah primary key, jadi tidak perlu bangun ulang tabel dan URL lama tidak rusak.

### 1.2 Auth multi-user

- Satu jalur sesi untuk semua, dengan peran di dalam token. Cookie terpisah untuk seller supaya `/admin` tidak bisa dibuka akun seller.
- Token HMAC sekarang hanya membawa `csrf`; diperluas agar membawa id pengguna.
- Rate limit per email dan per IP, dengan penyimpanan yang bertahan saat restart.

### 1.3 Halaman seller

- `/daftar` pendaftaran, `/masuk` login, `/akun` dasbor seller: produk saya, tambah, edit, pengaturan lapak.
- Formulir pendaftaran: nama toko, email, kata sandi, nomor WhatsApp. Nomor divalidasi dan dinormalkan seperti `normalisasiWa` yang sekarang.
- Batas ukuran unggah dan jenis file ditegakkan di server, bukan hanya di tag `accept`.

### 1.4 WhatsApp per seller

- Nomor pindah dari identitas global ke tabel `lapak`.
- Tombol WhatsApp di detail unit memakai nomor pemilik unit itu.
- Seller yang belum mengisi nomor tetap boleh daftar, tapi tombol WhatsApp disembunyikan di produknya, mengikuti pola `linkWa()` yang sekarang.

### 1.5 Moderasi

- Produk baru dari seller berstatus menunggu dan tidak tayang.
- `/admin/moderasi` jadi antrean, dengan terima atau tolak beserta alasan.
- Katalog milik Anda sendiri tetap langsung tayang.

### 1.6 Katalog

- Pagination, pencarian, dan filter seller.
- Halaman lapak masuk sitemap.
- Label "Terverifikasi" jadi bisa dicari, bukan sekadar hiasan.

### 1.7 Navigasi

- Tab "Akun" menggantikan tab "WhatsApp" di bar bawah, dikerjakan setelah 1.4 selesai supaya pembeli tidak kehilangan kontak selama transisi.
- Belum masuk: tab membuka `/masuk`. Sudah masuk: tab membuka `/akun`.

### 1.8 Dokumentasi

- `DESIGN.md` dan `README.md` diselaraskan dengan model multi-seller.

---

## Tahap 2 — Sebelum sekitar 200 sampai 300 seller

- SQLite ke PostgreSQL. Skema sudah benar dari tahap 1, jadi ini pindah data, bukan tulis ulang.
- Foto ke object storage, dengan pemrosesan resize di luar proses web.
- Rate limit ke Redis.
- Backup harian yang diverifikasi bisa dipulihkan.

Pemicu migrasi: seller mengeluh lambat saat mengunggah, `SQLITE_BUSY` muncul di log, atau disk foto lewat 70%.

---

## Urutan pengerjaan

- [x] 1.1 Skema `pengguna`, `lapak`, kolom pemilik di `hp`, migrasi non-destruktif
- [x] 1.2 Auth multi-user, peran di dalam token, rate limit yang bertahan saat restart
- [x] 1.3 Halaman `/daftar`, `/masuk`, `/akun`
- [x] 1.4 WhatsApp per seller
- [x] 1.5 Moderasi wajib dan `/admin/moderasi`
- [x] 1.6 Pagination, pencarian, filter seller di katalog
- [x] 1.7 Tab "Akun" di bar bawah
- [x] 1.8 Perbarui `DESIGN.md` dan `README.md`

## Catatan penyelesaian

Tahap 1 selesai dan sudah dideploy. Yang berubah dari rencana awal:

- **Tab WhatsApp tidak dihapus dari bar bawah.** Rencana awal berbunyi tab "Akun" *menggantikan* tab WhatsApp dengan alasan pembeli jangan kehilangan kontak. Begitu halaman seller selesai, alasan itu tidak berlaku lagi, jadi WhatsApp tetap satu klik dan "Akun" jadi tab keempat. Bar bawah selalu empat item.
- **Katalog tetap hanya menampilkan unit tersedia.** `katalogUnit()` punya opsi `hanyaTersedia` yang default aktif, karena kartu katalog tidak punya penanda "Terjual". Menampilkan unit terjual di katalog adalah keputusan isi konten, bukan perbaikan UI: perlu label status di kartu lebih dulu.
- **Verifikasi email belum ada.** Akun seller langsung aktif setelah daftar. Untuk tahap katalog ini cukup, tapi seller yang nakal tidak punya jalur lain untuk dihubungi selain nomor WhatsApp yang dia isi sendiri.

Yang sengaja tidak dikerjakan di tahap 1: PostgreSQL, object storage, Redis, dan multi-admin. Alasannya ada di bagian risiko skala di atas.

Setiap langkah: `npx astro check` bersih, `npm run build` lolos, lalu klik lewat di Chrome headless dari 360 sampai 1280 piksel. Hasilnya dilaporkan sebelum lanjut ke langkah berikutnya.

## Catatan keamanan yang ditemukan saat perencanaan

Kolom foto di `UnitForm.astro:148` berupa textarea nama file yang diisi bebas. Pada formulir seller, ini bisa diisi dengan nama file milik seller lain sehingga foto orang lain bisa ikut tampil di produknya. Saat seller memakai formulir ini, pilihan foto harus dibatasi hanya pada hasil unggahan milik seller tersebut. Formulir admin boleh seperti sekarang karena admin mengelola semuanya.

## Yang masih terbuka

- [ ] Pembayaran: tetap manual lewat WhatsApp, atau nanti ada QRIS?
- [ ] Verifikasi seller: cukup email, atau nanti perlu KTP?
- [ ] Batas jumlah foto dan ukuran unggahan per produk.