import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/** Where the Fastify API listens in development (its default port). */
const API_SERVER = 'http://localhost:3000'

/**
 * Backend paths this app calls; the dev server forwards them to the API.
 *
 * This is an allowlist, so a new backend route reaches Fastify in production
 * but 404s against Vite in development until it is added here.
 */
const API_PATHS = [
  '/import',
  '/run_filter',
  '/download',
  '/runs',
  '/criteria_presets',
  '/credentials',
]

/**
 * Variable naming a temporary tunnel hostname (for example an ngrok URL) that
 * Vite's development host check should let through. Read from the shell or an
 * untracked `web/.env.local`, so rotating the tunnel is not a code change.
 */
const TUNNEL_HOST_ENVIRONMENT_KEY = 'DEV_TUNNEL_HOST'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const tunnelHost = loadEnv(mode, process.cwd(), '')[TUNNEL_HOST_ENVIRONMENT_KEY]?.trim()

  return {
    plugins: [react()],
    server: {
      // Keep the public exception limited to the one tunnel hostname, and to
      // none when no tunnel is configured.
      allowedHosts: tunnelHost ? [tunnelHost] : [],
      // In production Fastify serves this app from its own origin. Forwarding the
      // same paths in development keeps every request same-origin there too, so
      // the client uses relative URLs and no CORS setup is needed.
      proxy: Object.fromEntries(
        API_PATHS.map((path) => [path, { target: API_SERVER, changeOrigin: true }]),
      ),
    },
  }
})
