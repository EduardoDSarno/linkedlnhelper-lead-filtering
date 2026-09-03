import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Where the Fastify API listens in development (its default port). */
const API_SERVER = 'http://localhost:3000'

/** Backend paths this app calls; the dev server forwards them to the API. */
const API_PATHS = ['/import', '/run_filter', '/download', '/runs']

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In production Fastify serves this app from its own origin. Forwarding the
    // same paths in development keeps every request same-origin there too, so
    // the client uses relative URLs and no CORS setup is needed.
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [path, { target: API_SERVER, changeOrigin: true }]),
    ),
  },
})
