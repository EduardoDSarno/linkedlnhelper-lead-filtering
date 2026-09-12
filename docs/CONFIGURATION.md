# Application configuration

Every setting is read from the environment at startup (loaded from `.env` by
`dotenv`). Blank or unset values fall back to the defaults defined in code.
`.env.example` mirrors this list.

## Secrets (required)

| Variable | Purpose |
| --- | --- |
| `APIFY_API_KEY` | Apify / HarvestAPI token used to collect LinkedIn profile data. Collection throws at startup without it. |
| `GEMINI_API_KEY` | Google Gemini token used for image analysis and profile evaluation. |

## Storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `src/dataStorage/db/application.sqlite` | SQLite file holding profiles, evaluation runs, and processing runs. Tests point this at a temp file. |
| `PROCESSING_TTL_HOURS` | `72` | How long a finished run's files (original CSV + both artifacts) are kept under `src/dataStorage/processing/{id}/` before the hourly cleanup pass deletes them and marks the run `expired`. Must outlive a human review, since expiring removes the retained original that decision overrides rebuild from. |

## API server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the Fastify server listens on (`npm run serve`). |
| `HOST` | *(unset — localhost only)* | Bind address. Leave blank for local development; set `0.0.0.0` when the server must accept external connections (for example inside a container). |

## Logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_PATH` | `output/pipeline.log` | File the CLI's pino logger writes to. |
| `LOG_LEVEL` | pino default (`info`) | Log verbosity. |

## Pipeline tuning (optional)

| Variable | Purpose |
| --- | --- |
| `MAX_PIPELINE_PROFILES` | Cap on profiles accepted in one run. |
| `APIFY_BATCH_SIZE` | Profiles per Apify Actor run. |
| `APIFY_BATCH_CONCURRENCY` | Actor runs in flight at once. |
| `APIFY_MAX_ATTEMPTS` | Attempts per profile, initial try included. |
| `APIFY_RETRY_BASE_DELAY_MS` | Base retry backoff before jitter. |
| `IMAGE_ANALYSIS_CONCURRENCY` | Images analyzed at once. |
| `IMAGE_ANALYSIS_RESOLUTION` | Image tokenization resolution: `low`, `medium`, or `high`. |
| `GEMINI_MODEL` | Gemini model id for image assessment, replaceable without a code change. |
| `GEMINI_REQUEST_TIMEOUT_MS` | One Gemini request's timeout. |

Blank values use the defaults defined next to each consumer (`src/dataCollector/apify_profile_collector/config.ts`, `src/imageExtractor/config.ts`, `src/pipeline/config.ts`).

## Fixed application behavior (code constants, not environment)

- API routes and status codes: `src/api/constants.ts`.
- Cleanup pass frequency: hourly (`CLEANUP_INTERVAL_MS` in `src/api/constants.ts`).
- Processing file layout: `src/dataStorage/processing/{id}/original.csv`, `approved-linked-helper.csv`, `evaluation-report.csv` (`processingPaths`).
- On server startup, runs left in `running` by a dead process are marked `failed` ("Interrupted by an application restart") and stay retryable.
