import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** The "source on GitHub" link comes from package.json, never a second copy. */
function repoUrl(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    repository?: { url?: string };
  };
  const raw = pkg.repository?.url ?? '';
  return raw.replace(/^git\+/, '').replace(/\.git$/, '');
}

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

/**
 * COOP/COEP are mandatory: without cross-origin isolation the wasm codecs lose
 * threads and SIMD, and AVIF/JXL become unusably slow. Dev and preview servers
 * must behave exactly like production (see `public/_headers`).
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(gitSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
    __REPO_URL__: JSON.stringify(repoUrl()),
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  optimizeDeps: {
    // The emscripten glue resolves its .wasm relative to its own module URL;
    // pre-bundling rewrites that path and breaks it.
    exclude: [
      '@jsquash/jpeg',
      '@jsquash/webp',
      '@jsquash/avif',
      '@jsquash/jxl',
      '@jsquash/png',
      '@jsquash/oxipng',
      'libheif-js',
    ],
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Keep every codec in its own chunk so nothing but the shell is
        // downloaded before the user picks a format.
        manualChunks(id) {
          const m = /node_modules\/@jsquash\/([a-z]+)\//.exec(id);
          if (m) return `codec-${m[1]}`;
          if (id.includes('libheif-js')) return 'codec-heif';
          return undefined;
        },
      },
    },
  },
});
