// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:8096';

export default defineConfig({
  site: SITE_URL,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'ignore',
  compressHTML: true,
  build: {
    assets: '_astro',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssMinify: 'lightningcss',
    },
  },
  devToolbar: { enabled: false },
});