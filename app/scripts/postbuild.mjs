// Copies the demo sites and SDK next to the built app and adds the GitHub Pages SPA fallback.
import { cpSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..');
const dist = path.join(appDir, 'dist');

if (!existsSync(dist)) {
  console.error('dist/ not found — run vite build first');
  process.exit(1);
}
cpSync(path.join(repoRoot, 'sites'), path.join(dist, 'sites'), { recursive: true });
mkdirSync(path.join(dist, 'sdk'), { recursive: true });
cpSync(path.join(repoRoot, 'sdk'), path.join(dist, 'sdk'), { recursive: true });
copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'));
writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('postbuild: copied sites/, sdk/, wrote 404.html and .nojekyll');
