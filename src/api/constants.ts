/** HTTP status codes the API routes return. */
export const HTTP_STATUS = {
  ok: 200,
  created: 201,
  accepted: 202,
  badRequest: 400,
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
} as const;

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