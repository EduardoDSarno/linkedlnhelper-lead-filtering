# Product roadmap and next steps

## Purpose

The project currently has a working data-acquisition pipeline. It imports
Linked Helper data, collects LinkedIn profiles through HarvestAPI on Apify,
normalizes the application-relevant profile fields, analyzes available profile
images through Gemini, and writes combined profile results.

The next stages should turn that pipeline into a reliable candidate-review
product. Acquisition, factual derivation, campaign rules, and human decisions
should remain separate so each layer can evolve without changing the raw data.

## Current foundation

- Linked Helper CSV parsing and input deduplication.
- Configurable, concurrent Apify profile collection.
- Successful-profile retention and classified provider failures.
- Round-based retries containing only transiently failed profiles.
- Minimal normalized `Profile` model with untouched raw Apify data.
- Employment deduplication without removing distinct simultaneous positions.
- Gemini profile-image analysis with structured results.
- Combined `FullProfile` output.
- Atomic JSON outputs, pipeline summaries, and structured Pino logs.
- Gemini token usage reported for successful and rejected images alike.
- Explicitly mismatched provider records rejected instead of being assigned to
  a requested profile by position.
- Deterministic tests across the import, mapping, image, and pipeline layers,
  none of which make a paid or network request.

The active Apify defaults and safety limits must always be read from
`src/data/apify_profile_collector/config.ts`; this document intentionally does
not duplicate their numeric values.

## Phase 1 (complete): validate the collector against the paid provider

The collector was validated against real HarvestAPI responses through the
benchmark runner in `src/benchmark/apify_profile_collector/`. That command
defaults to dry-run mode and reaches the paid provider only with `--execute`;
see its README for the escalating validation sequence and the artifacts each
run writes.

The sequence and confirmations below are retained as the procedure to repeat
whenever the plan, Actor, or provider limits change.

### Validation sequence

1. Run a small real collection containing known valid profiles.
2. Include known unavailable profiles to validate permanent failure handling.
3. Run one complete batch using the configured profiles-per-Actor-run default.
4. Run multiple batches using the configured Actor-run concurrency.
5. Increase toward a representative production import only after the earlier
   stages complete successfully.

### Confirm during each run

- Dataset records correlate to the correct input URLs.
- Provider error records match the shapes handled by the classifier.
- Permanent failures are not retried.
- Temporary provider and network failures are retried.
- Successful profiles are not requested again.
- Retry candidates from separate batches are pooled correctly.
- No requested profile disappears without either a result or failure record.
- Actor-run duration, total pipeline duration, and provider cost are recorded.
- The paid plan accepts the selected batch size and concurrency consistently.

### Deliverable

A short benchmark report containing input count, batch configuration, Actor
runs, collection rounds, success and failure totals, elapsed time, and observed
cost.

## Phase 2 (complete): expand automated coverage

Every layer between the CSV import and the written artifacts now has
deterministic coverage that runs without a paid Apify or Gemini request.

### What is covered

- Linked Helper CSV import, BOM handling, badge parsing, and deduplication.
- `mapApifyProfile`: complete and sparse payloads, partial dates, employment
  deduplication, simultaneous current roles, education, raw preservation.
- Gemini response parsing, including every enum, both apparent-age
  normalizations, and the observation and face-count boundaries.
- Profile image loading for byte, file, and remote sources, including size
  limits, unsupported content types, and aborted downloads.
- The Gemini client adapter: retry budget, structured-output settings, blocked
  and truncated responses, and billed-token reporting on failures.
- Image batching: input ordering, ID correlation, failure isolation, and the
  concurrency ceiling.
- The full pipeline end to end with fake providers, plus artifact round trips
  through the real atomic writer.
- Shared helpers: deduplication, type guards, and atomic JSON writing.

### Production and injected entry points

Each boundary keeps a simple production wrapper and exposes an injected variant
beneath it. Production callers use the wrapper; tests use the variant.

| Production wrapper | Injected variant |
| --- | --- |
| `collectApifyProfiles` | `collectApifyProfilesWithExecutor` |
| `extractProfileImages` | `extractProfileImagesWithExecutor` |
| `runFullProfilePipeline` | `runFullProfilePipelineWithDependencies` |

Two boundaries are injected through optional fields rather than a separate
function, because they have a single call site each: `ProfileImageLoadingOptions.fetchImage`
and `GeminiProfileImageRequest.generateContent`. Both default to the real
implementation when omitted.

The pipeline injects only genuine boundaries — the provider, the image
analyzer, the filesystem, and the clock. `mapApifyProfile` is deliberately not
injected: it is pure, so the integration test runs the real mapper and can
therefore catch drift between mapping and the pipeline.

### Adding fixtures

Shared fixtures live in `src/test_support/` and must never contain real
personal data. Reproduce provider field shapes with invented values, use the
reserved `.invalid` top-level domain for URLs, and expose builders rather than
shared constants so one test cannot mutate another's data. Apify fixtures carry
a `RAW_ONLY_SENTINEL` field that the mapper must ignore but preserve, which is
how raw-payload preservation is asserted.

### Running the suite

`npm test` runs the TypeScript type-check and then every test. The type-check
is not optional: tests execute through `tsx`, which strips types without
checking them, so a green test run alone does not prove the project compiles.
`npm run test:unit` runs the tests alone, and `npm run typecheck` the check
alone.

## Phase 3 (MVP complete): stable identity and persistence

Profiles are upserted in SQLite through the canonical LinkedIn profile key.
Reprocessing the same LinkedIn identity restores its original application ID,
and the stored `FullProfile` keeps the normalized data, image assessment, and
untouched raw provider payload together.

Complete evaluation runs are also stored in SQLite. Each run preserves its
criteria and evaluation result as validated JSON without duplicating complete
profiles. Advanced snapshot versioning, resume state, and run-specific artifact
directories are not MVP requirements and should be added only for a concrete
operational need.

## Phase 4 (MVP complete): evaluation data and direct signals

The evaluation mapper produces read-only, compact profile data containing the
professional, education, location, photo, image-analysis, and raw work-detail
signals currently needed by the product. Direct hard-exclude checks run before
Gemini and retain the evidence explaining every result.

## Phase 5 (MVP complete): campaign evaluation

`FullEvaluationCriteria` keeps campaign policy outside profile data. The current
evaluator provides:

- deterministic location, keyword, age, photo, and open-to-work filtering;
- batched and concurrent Gemini professional-fit evaluation;
- user-selected manual or automatic score-to-decision handling;
- explicit reasons, evidence, uncertainties, and token totals;
- compensation estimation with an insufficient-evidence outcome;
- deterministic comparison with the desired compensation range;
- isolated retry and failure handling.

The connected review pipeline now accepts a CSV plus criteria, creates stable
full profiles, evaluates them, and stores one evaluation-run record in SQLite.

### Running the complete review flow

```text
npm run review -- <path-to-csv> <path-to-criteria-json>
```

The criteria file uses the same fields as `FullEvaluationCriteria`. It is fully
validated before Apify or Gemini is called. The existing `collect` command
continues to stop after profile acquisition and image analysis.

## Phase 6: manual-review interface

Build a review experience displaying only the information useful to the
current workflow:

- Profile photo.
- Name, headline, location, and LinkedIn link.
- Current position or simultaneous current positions.
- Employment timeline.
- Education and education dates.
- Derived professional flags.
- Image usability and composition flags.
- Evaluation recommendation and reason codes.
- Approve, reject, and manual-review actions.
- Reviewer notes and campaign context.

Subjective appearance judgments should remain human-only and should not become
automatic employment rejection rules. Image analysis should support image
quality and manual review rather than make the final candidate decision.

## Phase 7: reviewer feedback

Store structured review outcomes before considering a trainable evaluation
model.

Capture:

- Profile and campaign IDs.
- System recommendation.
- Human decision.
- Approval or rejection reason codes.
- Rule overrides.
- Reviewer notes and identity.
- Decision timestamp.
- Ruleset, prompt, and model versions.

Use this feedback first to improve deterministic rules and prompts. Consider
custom model training only after enough consistent, representative labels have
been collected.

## Phase 8: export approved profiles

Add an explicit export stage after review. Define the required output format
from the real downstream workflow and export only approved profiles with their
stable identity, LinkedIn URL, and necessary campaign fields.

## Phase 9: operational hardening

Before routine large imports, add:

- Cancellation and graceful shutdown.
- Checkpoint and resume behavior.
- Pre-run cost estimates.
- Post-run provider-cost and Gemini-token totals.
- Per-stage latency and throughput metrics.
- Quota and rate-limit monitoring.
- Configurable limits per provider plan.
- Raw-data, output, log, and image retention policies.
- Secret-management and sensitive-data review.
- Alerts for unusual provider failure rates or incomplete runs.

## Recommended implementation order

1. ~~Validate the paid Apify configuration with controlled live runs.~~ Done.
2. ~~Add mapper, image extractor, and full-pipeline tests.~~ Done.
3. ~~Add stable profile identity and MVP persistence.~~ Done.
4. ~~Create compact evaluation data and direct first-pass signals.~~ Done.
5. ~~Implement configurable deterministic and model-assisted evaluation.~~ Done.
6. Build the manual-review interface.
7. Store reviewer feedback.
8. Export approved profiles.
9. Add production cost, performance, and operational controls.

## Immediate next task

Begin Phase 6: build the manual-review interface on top of the connected review
pipeline. The interface should submit the CSV and criteria, receive the returned
profiles and evaluation-run identity, and load the stored run from SQLite when
the results need to be revisited.
