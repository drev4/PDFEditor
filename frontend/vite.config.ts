import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * The Content-Security-Policy for the SPA (finding S5).
 *
 * It is built here rather than written into `index.html` for two reasons:
 *
 *  - `connect-src` has to name the API, which is a different origin and is
 *    configured per environment through `VITE_API_URL` (compile-time — see
 *    08-operations.md). A hardcoded policy would be wrong in every deployment
 *    except localhost.
 *  - The dev server needs directives production must not have. Vite talks to
 *    the browser over a WebSocket for HMR, so a policy that is correct for the
 *    built app breaks `npm run dev` — and the E2E suite runs against
 *    `npm run dev`, so that failure would land in Playwright looking like an
 *    application bug.
 *
 * Deliberately absent: `frame-ancestors`, `report-uri` and `sandbox`. A policy
 * delivered in a <meta> element cannot express them — browsers ignore them and
 * log a warning — so they have to come from a real response header set by
 * whatever serves this app in production. That requirement is recorded in
 * 08-operations.md.
 */
function buildCsp(mode: string, env: Record<string, string>): string {
  const apiOrigin = new URL(env.VITE_API_URL || 'http://localhost:3000/api').origin
  const isDev = mode !== 'production'

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'script-src': ["'self'"],
    // The one concession in this policy, and it was measured rather than
    // assumed. Running the editor and the public form under `style-src 'self'`
    // produces 423 violations in two shapes:
    //
    //   - 373 with effectiveDirective `style-src-attr` — `style` attributes,
    //     which is how Vue's `:style` bindings and the editor's absolutely
    //     positioned field overlays place things.
    //   -  50 with effectiveDirective `style-src-elem` — <style> elements,
    //     which is how PrimeVue 4 injects its theme at runtime.
    //
    // Because both shapes are needed, splitting this into `style-src-elem` and
    // `style-src-attr` grants exactly the same permission with more words: it
    // was tried and buys nothing. A nonce is not available either — nonces must
    // be per-response and index.html is a static asset here.
    //
    // Recorded in docs/sot/07-security-and-privacy.md rather than left for
    // someone to rediscover.
    'style-src': ["'self'", "'unsafe-inline'"],
    // Thumbnails are canvas.toDataURL() output; object URLs back the CSV and
    // PDF downloads.
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    // The pdf.js worker is bundled as a same-origin asset; blob: covers the
    // library's fallback path when it constructs a worker itself.
    'worker-src': ["'self'", 'blob:'],
    'connect-src': ["'self'", apiOrigin, 'blob:'],
  }

  if (isDev) {
    // Vite's HMR client. `ws:` and `wss:` rather than a fixed port because the
    // dev server moves when 5173 is taken.
    directives['connect-src'].push('ws:', 'wss:')
  }

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

function cspPlugin(mode: string, env: Record<string, string>): Plugin {
  return {
    name: 'inject-csp-meta',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: buildCsp(mode, env),
            },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

// https://vite.dev/config/
// Note: pdf.worker.min.mjs is copied to public/ folder manually
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      cspPlugin(mode, env)
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }
})
