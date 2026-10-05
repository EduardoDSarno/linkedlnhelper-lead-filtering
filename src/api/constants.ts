/** HTTP status codes the API routes return. */
export const HTTP_STATUS = {
  ok: 200,
  created: 201,
  accepted: 202,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
  internalError: 500,
} as const;

/** Route paths the API exposes. */
export const API_ROUTES = {
  import: '/import',
  review: '/run_filter',
  getProccessById: '/run_filter/:processingId',
  decisions: '/run_filter/:processingId/decisions',
  results: '/run_filter/:processingId/results',
  download: '/download/:processingId/:artifact',
  runs: '/runs',
  run: '/runs/:processingId',
  criteriaPresets: '/criteria_presets',
  criteriaPreset: '/criteria_presets/:presetId',
  credentials: '/credentials',
  credentialsCheck: '/credentials/check',
} as const;

/**
 * Variable holding an optional password for every route.
 *
 * Unset on the operator's own machine, where only localhost can connect. Set
 * it whenever the server is reachable from elsewhere, such as through a tunnel.
 */
export const ACCESS_PASSWORD_ENVIRONMENT_KEY = 'ACCESS_PASSWORD';

/** Challenge that makes the browser show its own login prompt. */
export const ACCESS_CHALLENGE = 'Basic realm="Leadscan", charset="UTF-8"';

/** Built web app the API serves, relative to the repository root. */
export const WEB_APP_DIRECTORY = 'web/dist';

/** Entry document handed to any path the single-page app routes itself. */
export const WEB_APP_ENTRY = 'index.html';

/** Field names shared by the API request and response bodies. */
export const API_FIELD = {
  processingId: 'processingId',
  criteria: 'criteria',
  artifact: 'artifact',
  overrides: 'overrides',
  publicId: 'publicId',
  decision: 'decision',
  reason: 'reason',
  name: 'name',
  skipCollection: 'skipCollection',
  thinkingEffort: 'thinkingEffort',
} as const;

/** Artifact types that can be downloaded. */
export const ARTIFACT_TYPE = {
  approved: 'approved',
  report: 'report',
} as const;
/** Content type accepted for a raw Linked Helper CSV upload. */
export const CSV_CONTENT_TYPE = 'text/csv';

/** Fastify body-parser mode that yields the upload as raw, undecoded bytes. */
export const PARSE_AS_BUFFER = 'buffer';

/**
 * Largest Linked Helper CSV the import route accepts, in bytes.
 *
 * Applied to the CSV parser alone rather than to the whole server, so the JSON
 * routes keep Fastify's 1 MiB default and a malformed request cannot ask the
 * process to buffer tens of megabytes.
 *
 * Observed exports run about 1.2 KB per row, so a campaign reaches Fastify's
 * default limit at roughly 870 leads — already close to the 741-row exports
 * being imported today. This carries around 28,000 rows, which leaves room for
 * campaigns well beyond the current scale.
 */
export const CSV_UPLOAD_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

/** Default port the API listens on. */
export const DEFAULT_PORT = 3000;

/**
 * How long a finished run's files are kept before the cleanup pass deletes
 * them, overridable through the PROCESSING_TTL_HOURS environment variable.
 * The window must outlive a human review, since expiring removes the retained
 * original CSV that decision overrides rebuild from.
 */
export const DEFAULT_PROCESSING_TTL_HOURS = 72;

/** Environment variable overriding the retention window, in hours. */
export const PROCESSING_TTL_ENVIRONMENT_KEY = 'PROCESSING_TTL_HOURS';

/** How often the running server repeats the cleanup pass. */
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;