/** HTTP status codes the API routes return. */
export const HTTP_STATUS = {
  ok: 200,
  created: 201,
  accepted: 202,
  badRequest: 400,
  notFound: 404,
  internalError: 500,
} as const;

/** Route paths the API exposes. */
export const API_ROUTES = {
  import: '/import',
  review: '/run_filter',
  getProccessById: '/run_filter/:processingId',
  download: '/download/:processingId/:artifact',
} as const;

/** Field names shared by the API request and response bodies. */
export const API_FIELD = {
  processingId: 'processingId',
  criteria: 'criteria',
  artifact: 'artifact',
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