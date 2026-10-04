#!/bin/sh
set -e

# --- Folder data & foto ------------------------------------------------------
mkdir -p "$DATA_DIR/foto"

# Seed foto contoh dipakai hanya saat folder foto masih kosong.
if [ "$SEED_DEMO" = "1" ] && [ -d /seed-foto ] && [ -n "$(ls -A /seed-foto 2>/dev/null)" ] && [ -z "$(ls -A "$DATA_DIR/foto" 2>/dev/null)" ]; then
  cp -r /seed-foto/. "$DATA_DIR/foto/"
  echo "[entrypoint] seed-foto disalin ke $DATA_DIR/foto/"
fi

# Rahasia sesi TIDAK lagi dibuat di sini.
#
# Dulu blok ini menulis data/.secret dan mengirimkannya lewat environment,
# sementara aplikasi juga menyimpannya di baris `session_secret` pada database.
# Dua sumber kebenaran untuk satu nilai, dan keduanya sudah berbeda satu sama
# lain di server ini: yang di file menandatangani sesi yang benar-benar aktif,
# yang di database sudah basi. Kalau baris database ikut disalin apa adanya,
# semua orang yang sedang login akan diminta login ulang.
#
# Sekarang Postgres yang memegang satu-satunya nilai, diambil sekali oleh
# `siapkanDatabase()` lalu disimpan di memori proses. Isi data/.secret lama
# sudah disalin ke sana saat migrasi, dan file-nya boleh dibiarkan atau
# dihapus tanpa efek apa pun.
#
# SESSION_SECRET dari environment tetap jadi pilihan pertama kalau diisi,
# untuk berkas konfigurasi yang dikelola di luar Compose.

# Beri hak tulis ke user `node` (uid 1000) untuk data.
chown -R node:node "$DATA_DIR"

# Keluar dari akses + hak root, jalankan aplikasi sebagai `node`.
exec su-exec node:node node /app/dist/server/entry.mjs