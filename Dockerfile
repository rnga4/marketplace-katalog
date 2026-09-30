# Tahap 1: build situs SSR dengan Node 22.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
ARG SITE_URL=http://localhost:8096
ENV SITE_URL=$SITE_URL
RUN npm run build

# Tahap 2: runtime aplikasi Node (Astro SSR + SQLite).
FROM node:22-alpine AS app

RUN apk add --no-cache su-exec

WORKDIR /app

# Runtime Astro (standalone) masih mengimpor beberapa paket @astrojs/*
# dari node_modules → pasang dependency produksi (tanpa alat build).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

EXPOSE 3000

# File DB & foto disimpan di volume /data (bind ./data).
VOLUME ["/data"]

# Entrypoint: siapkan folder + seed foto bila kosong, lalu jalan sebagai user node.
ENTRYPOINT ["/entrypoint.sh"]

# Tahap 3: gerbang Nginx untuk aset statis hash + foto, sisanya di-proxy ke app.
FROM nginx:1.27-alpine AS web

COPY nginx/web/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/client /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run && \
    ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

# Foto dibaca dari volume bersama (read-only) yang dipasang oleh compose.
RUN mkdir -p /usr/share/nginx/foto && chown nginx:nginx /usr/share/nginx/foto
VOLUME ["/usr/share/nginx/foto"]

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=10s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1