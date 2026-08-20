import { createApp } from './app/app.ts';
import { ensureCrossOriginIsolation } from './io/coi.ts';
import './styles.css';

const devMode = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

// Which build the person was looking at, in the console and in the corner.
console.info(
  `%cPixel Peep%c ${__BUILD_SHA__} · ${__BUILD_DATE__}\ncrossOriginIsolated=${self.crossOriginIsolated}`,
  'font-weight:600',
  'color:#888',
);

const app = createApp(devMode);
document.body.appendChild(app.root);

// A handle for debugging a live page and for the memory regression test.
// Read-only from the outside; nothing in the application reads it back.
Object.defineProperty(window, 'pixelPeep', {
  value: Object.freeze({ app, sha: __BUILD_SHA__, date: __BUILD_DATE__ }),
  writable: false,
  configurable: false,
});

const splash = document.getElementById('boot');
splash?.remove();

// If the host could not send COOP/COEP, put them back from a service worker.
// Does nothing when the headers already arrived.
void ensureCrossOriginIsolation();
