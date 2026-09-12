# Application snapshot — v1.0.0-mvp

**Baseline commit:** `9ae91cb` (`9ae91cbaafc54e443f17f12d1f24c9c0fa73ce4f`)
**Tag:** `v1.0.0-mvp`
**Date:** 2026-09-11
**Status:** Working MVP, in real use by the client.

This is a point-in-time record of the application as it stood when the client
began using it for actual campaign work, taken immediately before a
consolidation pass (deleting dead code, splitting oversized modules, adding a
run queue). Its purpose is to be the thing that pass is measured against: if
behavior changes, it changed against this.

To return here: `git checkout v1.0.0-mvp`
To see what moved since: `git diff v1.0.0-mvp`

---

## What it does

Filters LinkedIn lead lists exported from LinkedHelper against campaign
criteria, using an LLM, with a web UI for human review of the results. It sits
between LinkedHelper and the operator, replacing a manual one-by-one screening
pass.

Input is a LinkedHelper campaign CSV. Output is an approved-leads CSV in
LinkedHelper's own format, plus an evaluation report.

---

## Pipeline

```
CSV import → profile collection (Apify) → mapping → broad filter
          → image analysis → LLM evaluation → SQLite → review UI → export
```

| Stage | Where | Notes |
| --- | --- | --- |
| Import | `src/api/index.ts` (`/import`) | Parses the LinkedHelper CSV, extracts profile URLs, retains the original for retry. |
| Collection | `src/dataCollector/apify_profile_collector/` | Bebity primary, Harvest as failure-only fallback. Batched with bounded concurrency. |
| Mapping | `src/mapper/` | Raw provider payload → the app's `Profile` model, correlated back to `public_id`. One bad record fails alone. |
| Broad filter | `src/evaluation/filters/` | Deterministic knockouts before any token is spent. |
| Image analysis | `src/imageExtractor/`, `src/pipeline/image_analysis.ts` | Optional; costs extra tokens. |
| Evaluation | `src/evaluation/model/` | LLM scoring against campaign criteria. |
| Persistence | `src/database/` | `node:sqlite`. |
| Review | `web/src/` | Approve/reject individually or in bulk. |

### Two deliberate design decisions worth preserving

**The deterministic filter runs before the model.** Profiles that were never
going to pass never reach the LLM, so token spend tracks plausible candidates
rather than list size.

**The system prompt handles information; campaign prompts make decisions.**
The application prompt formats and states facts — employment status, dates,
photo provenance. Thresholds, weightings, and knockouts belong to the
per-campaign criteria the user writes. This separation is intentional and is
the constraint most easily broken by a well-meaning edit.

---

## Stack

- **Backend:** TypeScript, Node 22+, Fastify 5, Pino 10, `node:sqlite`
- **Frontend:** React 19, Vite, TypeScript
- **External:** Apify (Bebity + Harvest LinkedIn scrapers), OpenRouter (evaluation + image analysis)
- **Tests:** `node --test`, no external framework
- **Dependencies:** 6 runtime, 3 dev — deliberately small

---

## Size

| | Lines |
| --- | --- |
| Backend source (non-test) | 19,536 |
| Web source | 6,085 |
| Tests | 9,080 across 46 files |

Largest modules: `src/evaluation/` 3,591 · `src/dataCollector/` 2,378 ·
`src/pipeline/` 1,383 · `src/benchmark/` 1,328 · `src/api/` 1,189 ·
`src/database/` 735

**Test suite at this commit: 330 tests, 329 pass, 1 skipped, 3.7s.**
That number is the licence for the refactor that follows — it is fast enough
to run on every change and broad enough to catch a behavioral regression.

---

## API surface

| Route | Purpose |
| --- | --- |
| `POST /import` | Upload a LinkedHelper CSV, create a processing run |
| `POST /run_filter` | Start the pipeline against criteria |
| `GET /run_filter/:id` | Poll run status and progress |
| `POST /run_filter/:id/decisions` | Submit manual approve/reject overrides |
| `GET /run_filter/:id/results` | Read evaluated profiles |
| `GET /download/:id/:artifact` | Download approved CSV or evaluation report |
| `GET /runs`, `GET /runs/:id` | List and inspect runs |
| `POST/GET /criteria_presets` | Saved criteria |

No authentication on any route.

---

## Measured performance

From the verification run at this commit (50 profiles, evaluation only):

- **$0.99 per 1,000 profiles**
- **76 seconds for 50 profiles**, 50/50 scored, 0 failed
- 237,695 input tokens, 45,512 output

Full collection cycle (740 profiles, one campaign): approximately **$50** —
$29 Bebity flat, $15.70 Harvest per-event, $3.31 residential proxy, $1.88
compute. Proxy and compute bill to the Apify account, not the actor developer.

Per profile: ~4,744 input tokens, ~991 output. The fixed prompt prefix is
1,747 tokens, or **20.3% of all input** — re-sent on every request, and the
single largest untaken cost saving (prompt caching).

---

## Data quality, as of this commit

- **Dates:** 14,622 of 14,639 datable Bebity strings parse. Was 0 of 2,412 for education before `e7c26b4`.
- **Collection:** 652 of 652 profiles collected by Bebity, 0 failovers, 0 final failures.
- **Employment status:** computed, not inferred. Recheck of 68 no-current-role profiles moved approvals 13 → 1.
- **Photos:** scrapers miss photos restricted by LinkedIn visibility settings; the LinkedHelper export avatar is the fallback, tagged with its provenance. `requirePhoto` ranks rather than excludes.

### Known defects carried into this baseline

- **Two profiles drop silently per run** — their vanity URL changed after the export, so they cannot be correlated back to `public_id`. Reproducible from the Semana 37 dataset.
- **~4 of 615 genuine photo misses** from the provider.
- **Missing recent roles** on roughly 4 of 116 profiles — provider-side; the most recent position is absent from the payload.
- Provider-side items are worth reporting to Bebity rather than working around.

---

## Limits of this version

These are understood and accepted, not oversights. Detail in the concurrency
review; summarized here so the baseline is honest.

1. **No users.** No auth, no ownership, no sessions. Every run is visible and
   mutable by anyone who can reach the server.
2. **Single process by design.** Startup marks every `running` row as failed on
   the assumption that only this process executes pipelines. A second instance
   against the same database would kill the first one's live runs.
3. **Concurrency budgets are per-run, not global.** `EVALUATION_CONCURRENCY=100`,
   `IMAGE_ANALYSIS_CONCURRENCY=50`, `APIFY_BATCH_CONCURRENCY=6` each apply
   *inside* a run. Three simultaneous runs mean 300 in-flight model requests and
   18 concurrent actor runs with nothing arbitrating. This is the nearest real
   failure.
4. **SQLite is untuned.** Synchronous (`DatabaseSync`, blocks the event loop),
   no WAL, no `busy_timeout`. Concurrent writers throw rather than wait.
5. **Run progress is in-memory.** A `Map` in `src/api/run_progress.ts`; it does
   not survive a restart, though the run's database row does.
6. **No cost ceiling or per-user accounting.** One large upload spends the
   shared Apify and OpenRouter balance unchecked.

What *does* hold up: per-run isolation on disk and in the database, honest
crash recovery (orphaned runs fail, the original CSV is retained and the run
stays retryable), and a stateless model client.

---

## Known documentation drift at this commit

Recorded rather than fixed, so the cleanup pass has a list:

- `README.md` describes Harvest API as the collector. Bebity has been primary since `22eaf20`.
- `docs/CONFIGURATION.md` lists `GEMINI_API_KEY` as required and omits every `OPENROUTER_*` variable; evaluation runs on OpenRouter.
- `docs/CONFIGURATION.md` gives `PROCESSING_TTL_HOURS` a default of 72; the deployed `.env` uses 720.
- `EVALUATION_CONCURRENCY` is undocumented despite being the highest-impact tuning knob.

---

## Dead weight identified, not yet removed

- `src/outdated/` — empty directory (gitignored).
- `src/benchmark/` — 1,328 lines plus its own tests, unreachable from the application. A standalone tool; keep deliberately or delete.
- `src/api/index.ts` at 802 lines and `src/database/index.ts` at 652 lines are the two files auth and a Postgres migration will each have to rewrite.

---

## Repository conventions

- `npm test` = typecheck + unit tests. Must be green.
- `scripts/` is gitignored and checked separately (`npm run typecheck:experiments`, `npm run test:experiments`).
- `docs/` is gitignored. `CONFIGURATION.md` is tracked because it was force-added before the rule existed.
- Commits separate "moved code" from "changed behavior".
