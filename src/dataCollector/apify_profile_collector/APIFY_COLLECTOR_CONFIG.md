# Phase 1 Apify collector configuration

Phase 1 locks the following production defaults:

| Setting | Default | Safety ceiling | Environment override |
| --- | ---: | ---: | --- |
| Profiles per Actor run | 50 | 250 | `APIFY_BATCH_SIZE` |
| Concurrent Actor runs | 6 | 32 | `APIFY_BATCH_CONCURRENCY` |
| Attempts per profile | 3 | 5 | `APIFY_MAX_ATTEMPTS` |
| Initial retry delay | 1,000 ms | None | `APIFY_RETRY_BASE_DELAY_MS` |

`config.ts` is the executable source of truth. This document records the
validated Phase 1 snapshot and must be updated whenever those constants change.

## Why concurrency is six

Two disjoint paid benchmarks each requested 750 profiles using the same
profiles-per-Actor-run setting:

| Actor concurrency | First-attempt results | Queue errors | Retries | Total duration |
| ---: | ---: | ---: | ---: | ---: |
| 15 | 477 | 273 | 273 | 80.16 seconds |
| 6 | 750 | 0 | 0 | 79.58 seconds |

The higher-concurrency run caused HarvestAPI `429` responses with `Too many
queued requests (code_22)`. The lower-concurrency run collected every profile
in one round, with no Actor-log errors, while preserving the same practical
throughput. Six concurrent Actor runs is therefore the production baseline;
the higher ceiling exists only for explicit, controlled experiments.

## Runtime behavior

Callers may override defaults through `ApifyCollectorOptions` or the documented
environment variables. Function options take precedence over environment
values, and safety ceilings remain enforced.

Retries continue to include only profiles that did not succeed. A successful
profile is never resubmitted within the same collection operation.

## Changing the baseline

Any production-default change should be supported by a paid benchmark using a
disjoint profile sample. Compare first-attempt completion, provider queue
errors, retries, total Actor runs, duration, and final reconciliation before
updating `config.ts`, its configuration test, and this document together.
