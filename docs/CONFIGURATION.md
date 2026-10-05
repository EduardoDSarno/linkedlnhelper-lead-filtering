# Application configuration

Every setting is read from the environment at startup (loaded from `.env` by
`dotenv`). Blank or unset values fall back to the defaults defined in code.
`.env.example` mirrors this list.

## Secrets (required)

| Variable | Purpose |
| --- | --- |
| `APIFY_API_KEY` | Apify / HarvestAPI token used to collect LinkedIn profile data. |
| `OPENROUTER_API_KEY` | OpenRouter token used for profile evaluation. |

Both may be left blank: the app's setup screen collects them at runtime and
writes them into the process environment, optionally remembering them in
`src/dataStorage/credentials.json` (gitignored, owner-readable). A value set
here wins over a remembered one, so a development machine keeps its own keys.

## Model selection

| Variable | Purpose |
| --- | --- |
| `MODEL_PROVIDER` | Which adapter serves model calls. OpenRouter is the one implemented. |
| `OPENROUTER_MODEL` | Model id used for every stage, so a retired id is replaced without a code change. |
| `OPENROUTER_MODEL_THINKING_EFFORT` | Reasoning depth: `low`, `high`, or `max`. The largest single lever on how long a run takes, since thinking tokens are generated tokens. |
| `OPENROUTER_MAX_PROMPT_PRICE` / `OPENROUTER_MAX_COMPLETION_PRICE` | Per-million-token ceiling on what a backend may charge. A ceiling rather than a price sort: sorting by price pins every request to the single cheapest backend, which is also the slowest, and turns off load balancing. Lowering it narrows the field; a blank or unparseable value falls back to the default rather than lifting the cap. |

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
| `ACCESS_PASSWORD` | *(unset — no password)* | Password every route requires, entered in the browser's login prompt with any username. Leave blank only while the server is reachable from localhost alone; set it before exposing the app through a tunnel (ngrok) or a public `HOST`. |

For a tunnel against the Vite dev server, put its hostname in `DEV_TUNNEL_HOST`
(shell or an untracked `web/.env.local`); Vite rejects any other external host.

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
| `IMAGE_ANALYSIS_CONCURRENCY` | Photos downloaded at once for the evaluation request. |
| `IMAGE_ANALYSIS_RESOLUTION` | Image tokenization resolution: `low`, `medium`, or `high`. |

## Evaluation tuning (optional)

| Variable | Purpose |
| --- | --- |
| `EVALUATION_PROFILES_PER_REQUEST` | Profiles carried by one model request. Small on purpose: each request also carries that many photos, and the model's ability to bind an image to the right person degrades as the count grows. |
| `EVALUATION_CONCURRENCY` | Requests in flight at once. This is where throughput comes from, not request size. |
| `EVALUATION_REQUEST_TIMEOUT_MS` | Budget for a group's **first** attempt. Retries get a fraction of it, floored, because a retry that has not answered by then is nearly always one that never will — and the run cannot finish until its slowest chain does. |
| `EVALUATION_MAXIMUM_ATTEMPTS` | Attempts per group, initial try included. |
| `EVALUATION_RETRY_BASE_DELAY_MS` | Base retry backoff before the bounded exponential climb. |

Blank values use the defaults defined next to each consumer (`src/dataCollector/apify_profile_collector/config.ts`, `src/imageExtractor/config.ts`, `src/pipeline/config.ts`, `src/evaluation/model/config.ts`).

## Fixed application behavior (code constants, not environment)

- API routes and status codes: `src/api/constants.ts`.
- Cleanup pass frequency: hourly (`CLEANUP_INTERVAL_MS` in `src/api/constants.ts`).
- Processing file layout: `src/dataStorage/processing/{id}/original.csv`, `approved-linked-helper.csv`, `evaluation-report.csv` (`processingPaths`).
- On server startup, runs left in `running` by a dead process are marked `failed` ("Interrupted by an application restart") and stay retryable.
