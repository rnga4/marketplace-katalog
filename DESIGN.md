# Arah desain: Katalog HP Bekas + Panel Admin

Status: **sudah jadi ketetapan.** Bagian Identitas, Palet, dan Motif mengikat. Perubahan di sini harus dibahas lebih dulu, bukan diam-diam menyesuaikan komponen.

## Identitas

Marketplace katalog HP bekas. Ada toko katalog utama, ditambah seller yang mendaftar sendiri. Tiap seller punya satu lapak dengan nama dan nomor WhatsApp sendiri. Fokusnya tetap ke dua hal: foto unit yang jujur dan harga yang jelas. Pembeli utama orang yang sedang mencari HP second dan mau tahu persis kondisi unitnya sebelum tanya harga, lalu menghubungi penjualnya langsung lewat WhatsApp. Nada bicara lugas dan pendek, tidak ada kata "terbaik", "mulus 100%", atau "harga termurah" tanpa bukti (R-16, R-17, R-36).

Tidak menampilkan angka statistik penjualan, jumlah pengikut, atau testimoni. Tidak ada yang bisa diverifikasi, jadi tidak ditampilkan (R-17, R-18). Jumlah unit dan jumlah penjual di beranda adalah hitungan nyata dari katalog, bukan angka pemanis.

## Multi-seller: batas yang sudah diputuskan

Bagian ini mengikat, karena di sinilah celah yang bisa dipakai seller untuk menyalahgunakan fitur:

- **Satu akun satu lapak.** Satu akun punya paling banyak satu baris di `lapak`. Tidak ada lapak tambahan dan tidak ada nama dagang. Kalau seller butuh lapak kedua, itu model bisnis lain dan perlu keputusan baru.
- **Tidak ada keranjang, tidak ada pesanan, tidak ada alamat, tidak ada pembayaran daring.** Transaksi terjadi di luar situs: pembeli tanya lewat WhatsApp, seller membalas, transfer di luar sistem. Karena itu tidak ada layar yang meminta alamat, ongkos kirim, atau nomor transaksi.
- **Nomor WhatsApp tidak pernah diwariskan.** `waKontak()` mengembalikan nomor lapak seller untuk unit milik seller, dan nomor toko hanya untuk unit milik admin. Kalau seller belum mengisi nomor, nomornya tetap kosong dan tombol WhatsApp disembunyikan, bukan jatuh ke nomor toko. Kalau tidak begitu, pesanan pembeli terkirim ke orang yang tidak menjual unit itu.
- **Nomor WhatsApp adalah identitas masuk, dan satu nomor satu akun.** Formulir pendaftaran meminta tiga hal saja: nama toko, nomor WhatsApp, kata sandi. Email tidak diambil karena banyak seller tidak punya, dan nomor yang sama sudah bisa dihubungi pembeli. Karena nomor itu yang mengunci akun, satu nomor hanya boleh punya satu toko; kalau tidak, nomor itu jadi cara paling murah mengambil alih lapak orang lain. Konsekuensinya harus jujur: tidak ada email dan tidak ada tombol lupa kata sandi, jadi seller yang kehilangan nomornya tidak bisa masuk lagi. Itu batas yang diketahui, bukan sesuatu yang tersembunyi.
- **Seller hanya boleh menyentuh miliknya.** `listUnitsPemilik()` adalah satu-satunya sumber data untuk halaman `/akun`, dan edit atau hapus selalu mengecek kepemilikan sebelum menulis. `saringFoto()` menjaga supaya seller tidak bisa memasang file milik orang lain dengan menebak nama file.
- **Moderasi bawaannya wajib; auto-acc opsional.** Status unit tidak pernah datang dari formulir; `createUnit` menurunkannya dari siapa pemiliknya, dan setiap edit pada unit seller mengembalikannya ke antrean. Saklar "Terima otomatis" di `/admin/moderasi` bisa melewati antrean itu sekaligus mengaktifkan seller baru, tapi bawaannya mati supaya tidak ada produk atau akun yang tayang tanpa dilihat admin. Menolak berarti mengisi alasan, dan seller melihat alasan itu di `/akun` supaya tahu apa yang harus diperbaiki.


## Palet

| Peran | Warna | Kontras | Alasan |
|---|---|---|---|
| Aksen solid (tombol utama) | Emerald-700 `#047857` | 5.02:1 dengan teks putih | Makna "tersedia". Dipakai hanya di tombol Chat dan penanda status Tersedia |
| Aksen teks | Emerald-800 `#065f46` | 6.62:1 di stone-50 | Untuk teks aksen kecil yang butuh AA |
| Teks utama | Stone-900 `#1C1917` | 15.6:1 di stone-50 | |
| Teks sekunder | Stone-600 `#57534E` | 7.63:1 di putih | |
| Teks redup (hanya strikethrough Terjual) | Stone-500 `#78716C` | 4.60:1 di putih | Coretan status Terjual, AA |
| Dasar | Stone-50 `#FAFAF9` | | |
| Garis pemisah | Stone-200 `#E7E5E4` | | |

Dilarang pakai `stone-400` (`#A8A29E`) untuk teks: 2.52:1 di putih, gagal WCAG AA (antislop R-25).

`stone-500` hanya aman di atas `dasar` (4.59:1). Di atas `stone-100` ia turun ke 4.40:1 dan gagal, jadi di permukaanAbu terang teks memakai `stone-600` (6.99:1). Pola ini yang dipakai untuk label "Tanpa foto" dan input slug yang dinonaktifkan.

Warna garis penanda kondisi dipilih dari rasio kontrasnya di `stone-50`, bukan dari nama warnanya: emerald-700 5.25:1, amber-700 4.81:1, red-700 6.19:1 (WCAG 1.4.11 minimal 3:1). `amber-600` yang lebih murah hanya 3.05:1, jadi tidak dipakai: justru warna yang membawa sinyal "ada kekurangan" yang paling butuh kontras.

Aksen emerald dipakai di satu momen per layar: tombol utama detail (Chat via WhatsApp) dan penanda status Tersedia pada kartu. Bukan di setiap label, ikon, dan border.

Pengecualian fungsional: warna border penanda kondisi (lihat Motif) memakai tiga sinyal semantik (emerald / amber / red) untuk membedakan Mulus, Minus, Part saat memindai banyak unit sekaligus. Ini status nyata, bukan dekorasi. Warna dipakai sebagai garis kecil (2px, 1 gagal/ok merupakan sinyal), tidak pernah sebagai latar.

## Tipografi

Plus Jakarta Sans. Alasannya: sans geometrik dengan lebar angka yang stabil, cocok untuk daftar yang banyak angka (harga, kapasitas, baterai) dan tetap terbaca di layar HP kecil. Bukan Inter atau Geist karena itu default pilihan AI (R-06).

Skala fluid dengan `clamp()` supaya tidak melompat saat ganti breakpoint: `.judul-hero` (H1) 1.75rem ke 2.75rem, `.kepala-seksi` (H2) 1.35rem ke 1.75rem, body 1rem/1.625rem. Classes ini di `src/styles/global.css`, jangan pakai `text-3xl sm:text-4xl` manual.

## Motif

Garis pemisah horizontal sebagai penguat, bukan kotak dan bayangan. Grid katalog memakai garis `border-t border-l` lalu tiap sel menambah `border-r border-b`, jadi garisnya menyambung membentuk satu bidang (pola yang dipakai project material-bangunan).

Kartu bayangan tidak dipakai. Elemen yang bisa diklik cukup diberi hover dengan warna garis aksen, bukan bayangan mengambang (R-12).

Penanda kondisi adalah motif identitas: setiap unit menampilkan label kondisi jujur dengan warna garis semantik:
- **Mulus**, garis emerald. Kondisi unit sangat baik, layak dipakai sehari-hari.
- **Minus**, garis amber. Ada kekurangan minor: lecet halus, baterai menurun, atau yang sejenis. Dituliskan di halaman detail.
- **Part**, garis merah. Ada kerusakan nyata, butuh servis, dijual sebagai part/unit apa adanya.

Tidak boleh ada penanda "Mulus" pada unit yang tidak layak disebut mulus (R-36). Deskripsi kondisi memakai catatan spesifik seperti "Baterai health 92%", bukan klaim umum.

Galeri memakai satu tombol aktif pada satu waktu, ditandai `aria-pressed` dan garis aksen 2px. Foto utama ikut punya thumbnail-nya sendiri, jadi tidak ada foto yang tidak bisa dikembalikan setelah diganti. Label setiap tombol menyebut posisinya ("Tampilkan foto 2 dari 4"), karena label yang sama untuk semua tombol tidak bisa dibedakan pembaca layar.

## Beranda: ringkasan, penjual, pengumuman

Beranda bukan katalog. Ia menjawab "toko ini isinya apa dan siapa yang jual" dalam satu layar, lalu mengarahkan ke `/katalog` untuk melihat unit. Katalog pindah ke halamannya sendiri supaya pencarian dan paginasi punya URL yang jelas dan bisa dibagikan tanpa fragment.

- **Angka ringkas, bukan daftar unit.** Dua angka: unit tersedia dan jumlah penjual. Unit tersedia dihitung dari `hp` yang tayang dan masih tersedia; penjual dihitung dari lapak yang punya minimal satu unit seperti itu (`statistikRingkas()`), bukan dari jumlah akun. Toko ini sendiri tidak dihitung sebagai penjual.
- **Daftar penjual.** Tiap lapak yang punya unit tersedia tampil sebagai baris: avatar (foto toko kalau ada, kalau tidak inisial nama), nama, dan jumlah unit. `listLapakTersedia()` mengurutkan yang paling banyak unitnya lebih dulu.
- **Pengumuman dari admin.** Empat pengumuman terbaru yang aktif (`listPengumuman(true)`) tampil dengan baris baru aslinya. Kalau tidak ada, seluruh section hilang, bukan menampilkan kotak kosong. Isinya dikelola di `/admin/pengumuman`.
- **Aksen.** Satu aksen di layar ini: tombol "Lihat katalog", supaya tidak ada dua tombol aksen ke tujuan yang berbeda.
- **Tautan lama tetap hidup.** `/?cari=`, `/?lapak=`, dan `/?halaman=` dialihkan 301 ke `/katalog` dengan query yang sama, jadi tautan beranda versi lama tidak jadi 404.

## Katalog: paginasi, pencarian, filter penjual dan kondisi

Katalog tidak pernah memuat seluruh tabel. `katalogUnit()` di `src/lib/db.ts` menjalankan satu `COUNT` dan satu `SELECT` berparameter, lalu mengiris sendiri di SQL dengan `LIMIT`/`OFFSET`. Kalau katalog tumbuh ke ribuan unit, halaman `/` tetap memuat 24 baris, bukan semuanya.

- **Pencarian.** Kata kunci dipecah per kata dan setiap kata harus cocok (AND) di nama, merek, seri, storage, warna, atau deskripsi. `%`, `_`, dan `\` di kata kunci di-escape supaya `LIKE` memperlakukannya sebagai teks biasa, bukan wildcard. Maksimal enam kata, supaya query tidak bisa dipakai membebani database.
- **Filter penjual.** Dropdown diisi `listLapakTayang()`, yaitu lapak yang punya minimal satu unit tayang. Jadi tidak ada pilihan yang hasilnya selalu kosong.
- **Filter kondisi.** Dropdown tetap dari `PILIHAN_KONDISI` (Mulus/Minus/Part), pertanyaan pertama pembeli HP bekas. Nilai query yang tidak dikenal diabaikan, jadi `?kondisi=xyz` sama dengan tanpa filter.
- **Paginasi.** 24 unit per halaman, ditampilkan kalau ada lebih dari satu halaman. Nomor halaman yang melompat diganti elipsis, dan halaman di luar rentang dijepit ke rentang yang ada, jadi `?halaman=999` tidak menghasilkan halaman kosong. Tiap link membawa `cari`, `lapak`, dan `kondisi` yang sedang aktif supaya filter tidak hilang.
- **Filter tidak butuh JavaScript.** Formulernya `GET` ke `/katalog`, jadi pencarian tetap jalan kalau skrip gagal dimuat, dan hasilnya bisa dibagikan lewat tautan.
- **Nomor halaman dirantai sebagai query sungguhan.** `?cari=GB&halaman=2`. Fragment yang berisi query (`#katalog?cari=GB`) tidak pernah sampai ke server, jadi paginasi tidak akan bekerja.

Kartu katalog menampilkan nama penjual (`Dijual oleh ...`) supaya pembeli tahu siapa yang akan dihubungi, dan ke mana harus balik kalau unitnya sudah terjual.

## Katalog hanya menampilkan unit tersedia

Grid katalog publik memfilter `tersedia = 1`, jadi kartu tidak pernah menampilkan label "Terjual". Konsekuensinya kartu tidak punya cabang status apa pun: unit yang sudah terjual tidak tampil di katalog, dan orang yang mau mencari unit serupa diarahkan lewat WhatsApp dari halaman detail unit terjual. Kalau nanti toko memilih menampilkan unit terjual sebagai bukti kondisi yang jujur, itu keputusan isi konten, bukan perbaikan UI, dan label statusnya perlu ditambahkan kembali ke kartu dengan kontras yang diukur.

## Sasaran sentuh

Semua kontrol interaktif punya area sentuh minimal 44x44px (R-03, WCAG 2.5.8). Ditegakkan lewat utility `target-sentuh` di `src/styles/global.css`, bukan dengan menambah padding, supaya kepadatan admin tetap rapat tanpa target yang kecil. Checkbox dihitung lewat `<label>` pengaktifnya, karena yang diklik pengguna adalah label itu.

## Ritme seksi

RHYTHM 2, tidak seragam. Komposisi tiap seksi berbeda (disesuaikan isi saat eksekusi):

- Beranda: hero satu kolom pendek, strip angka ringkas, daftar penjual, lalu pengumuman. Tanpa grid unit.
- Katalog (`/katalog`): hero ringkas dengan pencarian, lalu grid dua kolom (HP) sampai empat kolom (layar lebar).
- Detail unit: galeri foto di kiri, informasi harga dan kondisi di kanan, spesifikasi sebagai daftar garis bawah, bukan kartu. Di mobile judul, status, dan ringkasan muncul di atas foto; harga dan tombol tetap di bawahnya.

Padding seksi bervariasi: `seks-luas` (4.5rem) untuk blok berlatar penuh, `seks-rapat` (2.5rem) untuk daftar padat.

## ENERGY 1, MOTION 1

ENERGY 1: tidak ada badge di atas H1, tidak ada radial orb, tidak ada glow. H1 langsung bicara.

MOTION 1: hanya hover dan transisi halus saat ganti foto galeri. Tidak ada loop, tidak ada pulse, tidak ada parallax, tidak ada scroll-reveal, dan tidak ada `scroll-behavior: smooth`. Lompatan ke anchor langsung pindah posisi, karena gerakan yang tidak ada alasan tertulis akan jadi wallpaper (R-19).

## Navigasi: kembali di header, tujuan utama di bawah

Navigasi mengikuti cara orang memakai katalog di HP, bukan tata letak dokumen.

- **Tombol kembali di kiri atas, halaman demi halaman.** Halaman yang punya halaman sebelumnya menampilkan chevron kiri plus nama tujuannya (`← Katalog`, `← Unit katalog`), menggantikan logo toko di sisi itu. Logo pindah ke footer yang sudah menampilkannya, jadi branding tidak hilang. Beranda tidak punya tombol kembali karena tidak ada halaman sebelumnya, dan tombol kembali yang ada selalu menyisakan `href` yang benar: tanpa JavaScript tetap sampai ke katalog, dan `history.back()` cuma dipakai kalau `referrer` masih di situs ini, supaya pengunjung dari tautan WhatsApp tidak justru dilempar keluar.
- **Tujuan utama pindah ke bar bawah di bawah 768px.** Dua tautan nav atas tidak muat bersama logo di 360px, jadi di lebar itu nav atas disembunyikan dan digantikan bar bawah: Beranda, Katalog, lalu tab terakhir yang selalu ada. Di atas 768px bar bawah hilang dan nav atas kembali, karena bar fixed di monitor besar cuma memakan ruang. Ikonnya digambar sendiri sebagai glyph fungsional (rumah, grid, roda setelan, orang), bukan dari set ikon generik. Kalau seller sudah masuk, tab Akun memakai foto tokonya (atau inisial kalau belum ada foto) menggantikan glyph orang, jadi bar bawah menjawab akun siapa yang sedang dipakai, bukan sekadar menandai halaman.

- **Tab terakhir mengikuti siapa yang sedang masuk.** Admin diarahkan ke `Kelola` karena itu tempat kerjanya. Siapa pun selain itu, termasuk pengunjung yang belum masuk, melihat `Akun`: seller yang sudah masuk mendarat di `/akun`, pengunjung lain mendarat di `/masuk`. Tidak ada tab yang bisa bertambah lagi, jadi bar bawah selalu tiga item.
- **WhatsApp keluar dari bar bawah, lalu dari header dan footer.** Tab WhatsApp dilepas supaya bar bawah hanya berisi tujuan yang benar-benar berpindah halaman: Beranda, Katalog, dan Akun/Kelola. Tombol generik di header dan tautan di footer ikut dihapus supaya tidak ada dua jalan ke nomor toko yang sama di tiap halaman. Kontak tetap satu klik dari tombol kontekstual di katalog, halaman lapak, dan detail unit; beranda cukup satu aksen, tombol "Lihat katalog".
- **Bar bawah tidak menutup isi.** Tingginya 3.75rem dan ruang bawah halaman dipesan dengan token yang sama, ditambah `env(safe-area-inset-bottom)` supaya tidak tertutup gesture bar iPhone. Target sentuh tiap tab 60px, di atas minimum 44px.
- **Tab aktif ditandai warna dan tebal, bukan titik atau badge.** Penanda posisi bukan informasi baru, jadi tidak perlu bentuk tambahan. Beranda dan Katalog sekarang halaman terpisah, jadi tab aktif ditentukan sekali di server dari path (`/` untuk Beranda, `/katalog`, `/hp/`, dan `/lapak/` untuk Katalog), tanpa `IntersectionObserver` yang mengikuti posisi gulir.
- **Detail unit tidak lagi punya breadcrumb.** Tombol kembali di header sudah menjawab "ke mana dan ke mana saja", jadi baris `Katalog / nama` di atas hanya mengulanginya.

- **`/akun` memakai bar bawah dan tombol kembali di atas.** Halaman kerja seller bukan panel admin, jadi ia ikut pola publik: bar bawah tiga tab tetap ada supaya seller bisa pindah ke Beranda atau Katalog tanpa lewat header, dan `/akun` (Produk saya) menampilkan tombol kembali ke Beranda di kiri atas, bukan tautan ke halaman itu sendiri. Subhalaman akun tetap memakai tombol kembali ke Produk saya. Saat tombol kembali sudah menuju `/akun`, chip identitas toko tidak ikut ditampilkan supaya tidak ada dua tautan ke tujuan yang sama. Kalau tampil, identitas toko menempel di pojok kanan atas: foto paling kanan dan nama di kirinya, di mobile ia sebaris dengan tombol kembali (kembali kiri, identitas kanan), di desktop nav ikut menempel kiri.

Panel admin tidak memakai bar bawah. Padat dan sering dipakai membandingkan isi, jadi menu tetap di atas dalam satu baris yang membungkus.

## Larangan

- Angka, harga, atau status unit yang sumbernya tidak jelas
- Badge capsule dengan titik dan glow
- Panah `→` sebagai hiasan
- Warna aksen emerald di lebih dari satu momen utama per layar
- Testimoni, hitungan terjual, atau statistik yang tidak bisa diverifikasi

## Panel admin

Panel admin bukan halaman pemasaran, jadi gaya utilitarian: rapat, tanpa hero, tanpa ilustrasi. Token warna, tipografi, dan bentuk tombol tetap sama supaya konsisten, hanya kepadatan yang berubah.

- **Gerak.** Halaman ikut crossfade antar halaman seperti seluruh situs (permintaan pemilik), tapi tanpa animasi susun dan tanpa kartu naik bergantian: isi langsung tampil begitu berpindah. Yang boleh bergerak hanya perpindahan halaman, hover tombol, dan pesan berhasil yang hilang sendiri.
- **Kepadatan.** Label field 0.875rem, jarak antar field `gap-3`, baris daftar `py-3`. Katalog publik boleh lapang; admin tidak, karena isinya banyak dan sering dibandingkan.
- **Hierarchy.** Di admin emerald tidak jadi warna utama layar. Emerald hanya untuk status berhasil (hijau) dan status gagal (merah), plus tombol submit. Judul halaman `text-xl`, cukup untuk tahu di mana berada tanpa perlu besar.
- **Aksen per layar.** Halaman daftar unit: aksen dipakai di tombol "Tambah unit" dan penanda status. Halaman form: aksen hanya di tombol submit. Halaman login: aksen hanya di tombol "Masuk". Tidak ada tombol warna aksen lain di layar yang sama. WhatsApp bukan lagi pengecualian di header: tombol generik di header dan footer sudah dihapus, jadi tiap layar hanya punya satu aksen pada aksinya sendiri. Beranda: "Lihat katalog". Katalog: "Tanya stok terbaru", sementara tombol submit filter "Terapkan" sengaja netral dan tetap ada saat filter aktif. Detail unit: tombol tanya aksen selama unit tersedia; unit terjual memakai tombol bergaris "Tanyakan unit lain lewat WhatsApp".
  - **Identitas seller selalu di pojok kanan atas.** Header publik menampilkan Beranda dan Katalog lalu identitas akun di ujung kanan pada semua lebar: seller melihat nama toko dan foto tokonya (atau inisial kalau belum ada foto) yang menaut ke `/akun`, pengunjung melihat ikon orang ke `/masuk`, dan admin melihat teks `Kelola`. Identitas seller tidak lagi cuma tampil di desktop; di mobile ia tetap di baris header, sebaris dengan logo atau tombol kembali, sementara tautan Beranda dan Katalog digantikan bar bawah. Beranda dan Katalog sekarang halaman terpisah, jadi tiap link punya tujuan sendiri (`/` dan `/katalog`) dan tidak ada tab aktif yang bergeser mengikuti gulir seperti dulu di bar bawah.
  - **Header publik menempel, header kerja tidak.** Katalog bisa panjang dan tidak semua halaman punya footer yang jelas, jadi header halaman publik `sticky` di atas: tanpa itu orang yang menggulir ke bawah kehilangan jalan kembali ke Katalog dan ke Akun. Sticky, bukan fixed, supaya posisinya tetap mengambil ruang di dalam dokumen dan tidak ada lompatan saat halaman dimuat. Header Admin dan Akun tidak ikut menempel, karena isinya bukan buat dibaca panjang: di mobile header Admin jadi dua baris setinggi 169px, dan space yang tersisa buat isi formnya akan tinggal sedikit. Keduanya juga sengaja dibuat ringkas supaya halaman edit unit seller masih menyisakan ruang yang layak.
- **Daftar, bukan tabel.** Daftar unit memakai baris (flex, bukan `<table>`): satu foto kecil, nama dan harga, lalu aksi. Tabel asli memaksa kolom punya lebar tetap dan menyempit di layar HP; baris menumpuk rapi di 390px tanpa mengubah struktur. Status Tersedia/Terjual tidak disembunyikan di layar kecil: itu field yang menentukan keputusan seller, jadi ia yang terakhir boleh hilang, bukan pertama. Seller menandainya sendiri lewat tombol "Tandai terjual"/"Tandai tersedia" di baris itu. Tombol aksinya (status, Ubah, Lihat halaman, Hapus) turun ke baris sendiri di bawah 640px supaya semuanya tetap punya area sentuh 44px.
- **Bukti sebelum merusak.** Hapus unit selalu dua langkah: klik "Hapus" memunculkan konfirmasi yang menyebut nama unit dan akibatnya, baru tombol "Ya, hapus". Panel konfirmasi muncul di baris unit itu, bukan di atas daftar, lalu digulir ke tengah layar dan fokusnya ditarik ke tombol "Ya, hapus". Di atas daftar, seller harus menggulir ulang dari awal hanya untuk membaca peringatan. Feedback setelah aksi berupa satu baris pesan di atas konten, hilang saat halaman berikutnya dimuat (lewat parameter `?notif=`), bukan toast yang menumpuk. Karena itu halaman admin hanya melompat ke atas kalau ada pesan; halaman konfirmasi hapus mengatur posisinya sendiri.
- **State kosong.** "Belum ada unit" ditulis sebagai kalimat biasa dengan satu aksi lanjutan, bukan ilustrasi. Di halaman publik berlaku aturan yang sama: bagian yang tidak punya isi tidak dikosongkan diam-diam. Deskripsi, Spesifikasi, dan Kelengkapan yang kosong diganti kalimat jujur yang memberi langkah lanjut, sementara "Kondisi unit" yang kosong hilang seluruhnya, mengikuti guard yang sudah dipakai di `catatan`. Subjudul dan kartu memakai helper `gabung()` di `src/lib/format.ts` supaya pemisah `·` tidak pernah berdiri sendiri saat field opsional kosong.
- **Form.** Label selalu ada di atas field (tanpa placeholder sebagai label), field wajib ditandai `<b>*</b>`, bantuan field seperti "satu per baris" ditulis kecil di bawahnya. Area unggah foto menampilkan thumbnail tiap foto yang sudah terpasang. Seller bisa membuang, memindah naik/turun, atau menjadikan sampul lewat tombol di thumbnail, tanpa mengetik nama file; tanpa JavaScript, textarea nama file tetap muncul sebagai cadangan.
- **Moderasi.** Unit seller masuk antrean, bukan daftar. Halaman `/admin/moderasi` memuat satu kartu per unit: foto, kondisi, harga, deskripsi, nama dan nomor WhatsApp penjual, link ke lapaknya, dan peringatan kalau seller belum mengisi nomor WhatsApp. Unit yang pernah ditolak menampilkan alasan sebelumnya supaya admin tidak perlu membuka akun seller untuk tahu konteksnya. Alasannya wajib diisi saat menolak, karena itulah yang dibaca seller di `/akun`. Di atas kartu antrean ada saklar terima otomatis dan daftar pendaftar seller yang menunggu disetujui, supaya keputusan akun dan keputusan produk ada di satu tempat.
- **Tiga status, bukan dua.** Menunggu, tayang, dan ditolak masing-masing punya tab dan penghitung, jadi produk yang ditarik tidak hilang begitu saja dan bisa ditinjau ulang tanpa mencari tahu dari mana.
- **Pakai banner, bukan navigasi tambahan.** Jumlah antrean unit dan pendaftar seller yang menunggu muncul sebagai banner di `/admin` dan badge di navigasi admin, jadi admin tahu ada yang menunggu tanpa harus membuka `/admin/moderasi` dulu.
- **Batasan admin.** Layout admin dan halaman login memakai `noindex, nofollow`. Panel ini tidak untuk indeks mesin pencari.
## Foto: satu unggah, tiga ukuran

Foto HP dari kamera smartphone sekitar 3-8 MB dan berdimensi ribuan piksel. Kalau file asli dipakai apa adanya di daftar dan thumbnail, satu halaman detail menarik belasan megabyte hanya untuk sesuatu yang isinya satu HP.

Aturannya: seller tetap mengunggah seperti biasa, pemrosesan terjadi di server dan tidak terlihat olehnya.

- **Tiga varian, satu nama.** `src/lib/foto.ts` menyimpan 1600px (nama yang masuk database), 1000px (`-m.webp`), dan 400px (`-t.webp`). Database tetap menyimpan satu nama file per foto supaya tidak ada yang harus disinkronkan dua kali.
- **Browser yang memilih.** Detail dan katalog memakai `srcset`/`sizes`, bukan `width`/`height` tebakan. konsekuensinya galeri tetap benar di layar 390px maupun monitor lebar, dan layar retina 390px otomatis naik ke varian 1000px karena 400px akan terlihat pecah.
- **Thumbnail bukan foto utama.** Tombol galeri menyimpan varian 1600px beserta `srcset`-nya, bukan file 400px. Kalau thumbnail yang dipasang sebagai foto utama, setiap klik galeri akan menurunkan kualitas foto — bug yang tidak terlihat di jaringan cepat tapi langsung terasa di paket data.
- **Batas unggah 120 MB, bukan 25 MB.** Batas lama 25 MB ditolak oleh nginx sebelum sampai ke aplikasi, jadi seller hanya melihat "413 Request Entity Too Large" tanpa tahu kenapa. Karena foto langsung dikompres, batas yang lebih longgar tidak menambah pemakaian disk. Pelampauan batas tetap punya halaman sendiri yang menjelaskan cara mengatasinya.
- **Foto profil toko memakai jalur yang sama.** `/akun/toko` menyimpan foto lewat `simpanFoto()` dengan varian thumb/sedang/besar, dan satu kolom `lapak.foto` menyimpan nama file besarnya. Avatar di header `/akun`, header publik, tab Akun bar bawah, daftar penjual beranda, dan halaman lapak publik memakai varian 400px, jadi tidak ada file besar yang diunduh hanya untuk avatar. Mengganti foto menghapus file lama setelah yang baru tersimpan; menghapus foto mengembalikan avatar ke inisial nama toko, bukan gambar karangan (R-23, R-38).
- **Label placeholder wajib terbaca.** `FOTO CONTOH` ditulis lewat SVG `<text>`. Tanpa font di tahap build, librsvg mengabaikannya dan seluruh placeholder satu unit menjadi file identik — katalog penuh foto yang sama tanpa tanda bahwa itu contoh. `scripts/generate-sample-images.mjs` sekarang membandingkan hasil render dan berhenti kalau teksnya hilang, bukan diam-diam menghasilkan 10 foto yang sama.

## Identitas dari panel, bukan dari kode

Nama toko dan nomor WhatsApp duluan ditulis di `src/data/site.ts`, yang berarti mengubah nomor WhatsApp selalu butuh build ulang dan deploy ulang. Untuk katalog yangpemilik toko mengubah contact info sesekali, itu hambatan yang tidak perlu ada.

- **Sumber kebenaran pindah ke database.** Identitas disimpan sebagai satu baris JSON di tabel `pengaturan` dan dibaca lewat `ambilSite()` yang menyimpan cache per proses. Header, footer, judul halaman, tombol WhatsApp, dan pesan detail unit semuanya membaca nilai yang sama, jadi tidak mungkin nama toko berbeda antar halaman.
- **Nomor boleh dikosongkan.** Nilai bawaan punya `whatsapp` kosong, dan `linkWa()` mengembalikan `null` kalau nomornya tidak ada. Semua tombol WhatsApp hilang dari halaman publik, dashboard admin memberi tahu nomornya belum diisi, dan tidak ada nomor karangan yang tidak sengaja diklik. Memasang nomor lebih baik daripada menampilkan tombol yang salah.
- **Bentuk nomor dinormalkan sekali.** Seller boleh mengetik `08xx` atau `+62xx`; yang tersimpan dan terpakai selalu `62xx`. Pengetikan ulang tidak perlu dan tidak ada nomor yang bisa salah tempel ke dua format berbeda.
- **Logo mengikuti nama.** Kotak header memakai inisial nama toko, jadi branding ikut berubah begitu nama diisi dan tidak perlu file logo dulu.

## Update gerak (permintaan pemilik, menggantikan MOTION 1 di atas)

Pemilik meminta pengalaman yang lebih hidup, di setiap path. Aturan gerak tinggal di satu tempat, `src/styles/global.css`, supaya berlaku sama di semua layout (publik, akun, auth, dan admin): crossfade antar halaman (view transitions native; header publik dan bar bawah tetap, karena elemen yang isinya sama diberi nama), foto kartu ke detail sebagai shared element, fade-in foto saat selesai dimuat, kartu katalog naik bergantian saat halaman dibuka, umpan balik tekan pada tombol, dan spinner di tombol submit admin. Semua di bawah `prefers-reduced-motion: no-preference`, kecuali spinner. Tetap dilarang: loop tanpa henti, pulse, parallax, scroll-reveal, dan `scroll-behavior: smooth`.
