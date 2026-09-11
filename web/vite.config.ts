import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
]

/** Current ngrok hostname allowed through Vite's development host check. */
const NGROK_ALLOWED_HOST =
  '368b-2001-569-71ae-f500-6504-68b3-d0fc-70af.ngrok-free.app'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Keep the public exception limited to the temporary tunnel hostname.
    // A new ngrok URL must be added here before its requests can reach Vite.
    allowedHosts: [NGROK_ALLOWED_HOST],
    // In production Fastify serves this app from its own origin. Forwarding the
    // same paths in development keeps every request same-origin there too, so
    // the client uses relative URLs and no CORS setup is needed.
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [path, { target: API_SERVER, changeOrigin: true }]),
    ),
  },
})
