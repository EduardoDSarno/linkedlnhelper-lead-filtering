import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** The repository root, where `.env` lives. */
const ROOT_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));

/** The API server's port when `.env` does not set PORT, matching the server's own default. */
const DEFAULT_API_PORT = "3000";

/**
 * In development Vite serves the pages and forwards `/api` to the Fastify
 * server, so both look like one site and the session cookie just works. In
 * production the built files in `web/dist` are served by Fastify itself.
 */
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ROOT_DIRECTORY, "");
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [react(), tailwindcss()],
    server: {
      proxy: { "/api": `http://localhost:${environment["PORT"] || DEFAULT_API_PORT}` },
    },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
