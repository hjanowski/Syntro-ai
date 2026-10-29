import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Dev-only: serve the demo sites and the SDK from the repo so the embedded engine works without the Node host. */
function staticSites(): Plugin {
  const mounts: Record<string, string> = { '/sites/': path.join(repoRoot, 'sites'), '/sdk/': path.join(repoRoot, 'sdk') };
  return {
    name: 'syntro-static-sites',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const base = server.config.base.replace(/\/$/, '');
        for (const [prefix, dir] of Object.entries(mounts)) {
          const full = base + prefix;
          if (!url.startsWith(full)) continue;
          const rel = decodeURIComponent(url.slice(full.length));
          const file = path.normalize(path.join(dir, rel));
          if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), staticSites()],
  resolve: {
    alias: {
      '@syntro/engine': path.resolve(repoRoot, 'engine/src/index.ts'),
      '@': path.resolve(here, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  // `vite preview` serves the production build exactly like GitHub Pages: no engine API, so the app runs embedded.
  preview: { port: 4173, proxy: {} },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
