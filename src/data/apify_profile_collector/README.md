# Apify profile collector

This module is the fault-tolerant provider boundary between a list of LinkedIn
URLs and the rest of the full-profile pipeline. It preserves successful Apify
records untouched and reports unsuccessful URLs separately.

## Processing flow

1. Trim and deduplicate the input LinkedIn URLs.
2. Split pending URLs using the configured profiles-per-Actor-run limit.
3. Run Actor batches using the configured concurrency limit.
4. Wait for every batch in the current round to settle.
5. Keep successful records immediately.
6. Record permanent failures, such as a `404`, without retrying them.
7. Pool transient failures from every batch, split them into new batches, and
   run the next retry round after exponential backoff.
8. Return successful profiles, final failures, and collection statistics.

Waiting for a complete round before retrying is deliberate. If several initial
batches each contain one temporary failure, those failed URLs can share one
retry Actor run. Successfully collected profiles are never requested again.

## Failure rules

| Condition | Category | Retried? |
| --- | --- | --- |
| `404` or "not found" | `not_found` | No |
| `400` or `422` | `invalid_request` | No |
| `401` or `403` | `authentication` | No; aborts the collection |
| `408` or timeout message | `timeout` | Yes |
| `429` | `rate_limited` | Yes |
| `5xx` | `provider_unavailable` | Yes |
| Missing/malformed provider result | `invalid_response` | Yes |
| Network/unknown run error | `network` | Yes |

Transient errors use the configured attempt budget. A retry-exhausted profile
is returned in `failures`; it does not discard or block unrelated successful
profiles.

## Limits and configuration

The current paid-plan operating configuration is intentionally bounded:

- profiles per Actor run: 50 by default, with a temporary application ceiling
  of 250 while larger batches are benchmarked;
- Actor-run concurrency: 6 by default, capped at the Starter-plan limit of 32;
- attempts: 3 by default, 5 maximum;
- initial retry delay: 1,000 ms, followed by exponential backoff and jitter.

The source of truth for defaults and safety ceilings is `config.ts`. Function
options take precedence over environment values, which take precedence over
those defaults. The supported environment variables are:

```text
APIFY_BATCH_SIZE
APIFY_BATCH_CONCURRENCY
APIFY_MAX_ATTEMPTS
APIFY_RETRY_BASE_DELAY_MS
```

The caller may also pass `ApifyCollectorOptions`. Values above the safety caps
are clamped rather than accepted.

See [PHASE_1_CONFIGURATION.md](./PHASE_1_CONFIGURATION.md) for the benchmark
evidence and change policy behind the production baseline.

## Returned data

`collectApifyProfiles` returns an `ApifyCollectionResult`:

- `profiles`: untouched successful Apify objects, ordered like the input;
- `failures`: permanent and retry-exhausted failures, ordered like the input;
- `stats`: rounds, Actor runs, attempts, successes, and failure totals.

The full-profile pipeline writes successes to
`output/apify-profiles.json` and failures to
`output/apify-profile-failures.json`. Only successful profiles continue to the
normalization and image-analysis stages.

## Files

- `apify_profile_collector.ts`: scheduling, classification, retry logic, and
  the production Apify executor.
- `config.ts`: defaults, safety limits, environment parsing, and API-key access.
- `constants.ts`: provider identifiers and HTTP status constants.
- `error_handling.ts`: provider error classification and failure construction.
- `helper.ts`: provider-value checks and LinkedIn URL normalization.
- `types.ts`: public inputs, outputs, failure categories, and executor types.
- `index.ts`: the module's public exports.
- `config.test.ts`: deterministic configuration and validation tests.
- `apify_profile_collector.test.ts`: deterministic tests using an injected
  executor; they do not call Apify.
- `PHASE_1_CONFIGURATION.md`: locked production baseline and benchmark evidence.
