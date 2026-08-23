# Apify profile collector

This module is the fault-tolerant provider boundary between a list of LinkedIn
URLs and the rest of the full-profile pipeline. It preserves successful Apify
records untouched and reports unsuccessful URLs separately.

## Processing flow

1. Trim and deduplicate the input LinkedIn URLs.
2. Split the pending URLs into batches of at most 10 profiles.
3. Run up to 10 Apify Actor batches concurrently.
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

Transient errors use three total attempts by default: the initial request and
up to two retries. A retry-exhausted profile is returned in `failures`; it does
not discard or block unrelated successful profiles.

## Limits and configuration

Production values are intentionally bounded:

- batch size: 10 profiles maximum;
- Actor-run concurrency: 10 maximum;
- attempts: 3 by default, 5 maximum;
- initial retry delay: 1,000 ms, followed by exponential backoff and jitter.

The following environment variables can reduce or tune those defaults:

```text
APIFY_BATCH_CONCURRENCY=10
APIFY_MAX_ATTEMPTS=3
APIFY_RETRY_BASE_DELAY_MS=1000
```

The caller may also pass `ApifyCollectorOptions`. Values above the safety caps
are clamped rather than accepted.

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
- `types.ts`: public inputs, outputs, failure categories, and executor types.
- `index.ts`: the module's public exports.
- `apify_profile_collector.test.ts`: deterministic tests using an injected
  executor; they do not call Apify.
