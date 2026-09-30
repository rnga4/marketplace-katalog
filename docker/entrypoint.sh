#!/bin/sh
set -e

# --- Folder data & foto ------------------------------------------------------
mkdir -p "$DATA_DIR/foto"

# Seed foto contoh dipakai hanya saat folder foto masih kosong.
if [ "$SEED_DEMO" = "1" ] && [ -d /seed-foto ] && [ -n "$(ls -A /seed-foto 2>/dev/null)" ] && [ -z "$(ls -A "$DATA_DIR/foto" 2>/dev/null)" ]; then
  cp -r /seed-foto/. "$DATA_DIR/foto/"
  echo "[entrypoint] seed-foto disalin ke $DATA_DIR/foto/"
fi

# Rahasia sesi stabil antar-restart, bila belum diatur dari env.
if [ -z "$SESSION_SECRET" ]; then
  if [ -f "$DATA_DIR/.secret" ]; then
    SESSION_SECRET=$(cat "$DATA_DIR/.secret")
  else
    SESSION_SECRET=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
    echo "$SESSION_SECRET" > "$DATA_DIR/.secret"
    chmod 600 "$DATA_DIR/.secret"
    echo "[entrypoint] SESSION_SECRET dibuat baru di $DATA_DIR/.secret"
  fi
  export SESSION_SECRET
fi

# Beri hak tulis ke user `node` (uid 1000) untuk data.
chown -R node:node "$DATA_DIR"

# Keluar dari akses + hak root, jalankan aplikasi sebagai `node`.
exec su-exec node:node node /app/dist/server/entry.mjs