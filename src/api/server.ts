import { buildServer } from './index.js';
import { DEFAULT_PORT } from './constants.js';


/** Builds the app and starts listening, exiting the process on a failed bind. */
async function startServer(): Promise<void> {
    const app = await buildServer();
    const host = getHostFromEnv();
  
    app.listen(
      { port: getPortFromEnv(), ...(host ? { host } : {}) },
      (error, address) => {
        if (error) {
          app.log.error(error);
          process.exit(1);
        }
        app.log.info(`Server is running on ${address}`);
      },
    );
  }
  
  void startServer();

  
/** Reads the port from the environment, falling back to the default. */
function getPortFromEnv(): number {
  const port = process.env['PORT']?.trim();
  return port ? Number.parseInt(port, 10) : DEFAULT_PORT;
}

/**
 * Reads the optional bind address from the environment.
 *
 * An empty value leaves the host unset so Fastify binds to localhost, which
 * only accepts local connections. Deployments that must accept external
 * connections set HOST (for example 0.0.0.0 inside a container).
 */
function getHostFromEnv(): string | undefined {
  return process.env['HOST']?.trim() || undefined;
}

