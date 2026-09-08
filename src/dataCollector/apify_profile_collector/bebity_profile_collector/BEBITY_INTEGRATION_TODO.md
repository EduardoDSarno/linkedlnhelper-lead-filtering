# Bebity production integration — TODO

Bebity (`bebity/linkedin-premium-actor`) is roughly 4x cheaper per profile than
HarvestAPI. This module currently only supports the benchmark path
(`collectBebityProfiles` preserves raw records untouched, matching the
apify_profile_collector benchmark harness). Moving it into the production
pipeline — replacing HarvestAPI for the profiles it can safely serve — needs
the work below.

## Confirmed findings (this session)

- **Non-ASCII vanity slugs break Bebity.** Its actor truncates a profile
  slug at the first character outside `a-z`, `0-9`, `-`, then looks up the
  truncated string. This sometimes returns an unrelated LinkedIn member who
  happens to own that shorter slug — not just a clean miss. Percent-encoding
  the URL does **not** help: raw and encoded input truncate to the identical
  string (verified against live Bebity output, byte-for-byte). Filed against
  https://github.com/bebity/linkedin-premium-actor/issues.
- **Fix shipped:** `eligibility.ts` (`isBebityCompatibleProfileUrl`,
  `partitionProfileLinksForBebity`) routes any URL whose decoded slug isn't
  pure `[a-zA-Z0-9-]` to Harvest instead. Validated against a real 200-profile
  batch: 0 false positives, catches all 25 truncation failures (the other 2
  failures in that batch were unrelated provider noise, ~1% baseline).
- **Raw schema does not match `mapApifyProfile` / `evaluation/mapper.ts`.**
  Those were written against HarvestAPI's shape specifically. See the field
  map below.
- **Content is otherwise equivalent** for what today's evaluation actually
  reads — this was the open question, now resolved. No blocking gap remains
  for the current `criteria.json` once the mapping below is built.

## Field mapping needed (Bebity raw → Harvest-shaped raw)

Build one adapter that reshapes a Bebity dataset item into the same raw shape
Harvest already produces, so `mapApifyProfile` and `evaluation/mapper.ts`
need **no changes** — the fix lives entirely at the collector boundary.

| Normalized use | Harvest raw field (current code reads this) | Bebity raw field | Transform |
| --- | --- | --- | --- |
| Bio text (`about`) | `about` | `summary` | rename |
| Photo (`photo`, drives `hasPhoto`/image analysis) | `photo` | `profilePictureUrl` | rename |
| Job title (`experience[].position`) | `position` | `title` | rename |
| Experience dates | `{ year, month, text }` object | plain string (`"Sep 2021"`, `"Present"`) | parse into `{ text, month, year }`; mapper already has a `MONTHS` lookup we can reuse |
| Education degree | `degree` | `degreeName` | rename |
| Education dates | `{ year, month, text }` object | plain string | same date-string parse as experience |
| `openToWork` | boolean | **not present at all** | leave unset — filter already treats absent as "unknown, don't exclude"; not in current `criteria.json` anyway |

## Location — needs a small parser, not just a rename

Bebity's `location` is one flat string (`"Goiânia, Goiás, Brasil"`), same
shape as HarvestAPI's `location.linkedinText` but with no pre-parsed
`city`/`state`/`country`/`countryCode` alongside it. Current `criteria.json`
filters on the *structured* `state` field, and `evaluateLocation`'s
`locationHasCityOrState` guard only trusts structured `city`/`state` (not the
free-text field) to decide whether a "no match" should actually exclude
someone. So we can't just drop the string into `location.text` — every
exclusion would silently degrade to "unknown" and nobody would ever get
filtered out.

Fix: parse the flat string into `{ linkedinText, parsed: { city, state,
country, countryCode } }` using the same Brazilian state/UF table that
`src/evaluation/filters/brazil_location.ts` already trusts
(`BRAZIL_STATE_BY_UF`) — reuse or export its `resolveBrazilRegion` rather than
reimplementing state-name matching. This produces the exact object shape
`mapLocation` in `apify_profile_mapper.ts` already expects, so nothing
downstream needs to change.

- [x] Export `resolveBrazilRegion`. It now lives in `src/mapper/brazil_location.ts`,
      next to the adapter, since the deterministic location filter that used to
      own it has been retired.
- [x] Write the location parser (shipped as `adaptBebityLocation` inside
      `bebity_raw_profile_adapter.ts`), producing Harvest-shaped `location`.
- [x] Test against real samples already in
      `output/benchmarks/bebity/*/profiles.json` and `test_data/*.csv`
      (`location_name` column has the same flat format — useful as extra
      parser test fixtures even though it isn't the data source in production).

## Remaining TODOs

- [x] Write `adaptBebityRawProfile(raw)` implementing the field map above
      (rename + date parsing + location parsing), returning a Harvest-shaped
      `RawApifyProfile`.
- [x] Wire a real (non-benchmark) Bebity collector that: partitions input via
      `partitionProfileLinksForBebity`, calls Bebity for the compatible slice,
      calls the existing Harvest collector for the rest, adapts Bebity raw
      records, and merges both result sets before they reach `mapApifyProfile`.
- [x] Add Bebity's own concurrency default (`resolveBebityConcurrency` in
      `bebity_profile_collector.ts`), sourced from `BEBITY_BATCH_CONCURRENCY`
      with a safety ceiling — see the `.env.example` concurrency note below.
      Batch size, retry, and backoff still fall through to the shared
      `apify_profile_collector/config.ts` (untested separately from Harvest;
      no evidence yet that Bebity needs its own values for those).
- [ ] Re-run the 200+ profile paid benchmark against the *adapted* records
      (not raw) and confirm the evaluation/broad-filter output matches what
      Harvest would have produced for the same profiles, per
      `APIFY_COLLECTOR_CONFIG.md`'s "any production-default change needs a
      paid benchmark" policy.
- [ ] Decide whether to keep `DEFAULT_BEBITY_PROFILE_FIELDS = ['about',
      'experience']` — each entry is a separate LinkedIn request Bebity makes
      per profile (cost + latency), and nothing in the pipeline currently
      reads `languages`/`skills`/`honors`/`projects`/`organizations`, so there's
      no reason to enable them unless a future campaign's criteria need them.
- [ ] Restore `openToWork` from the Linked Helper CSV instead of the provider.
      Bebity does not return the field at all (confirmed across 189 live
      records in `output/benchmarks/bebity/`), so every Bebity-collected
      profile reaches the model with the `openToWork` criterion but no value
      to judge it against — the model can only infer availability from the
      bio or last role. The data is already parsed at import
      (`imported_csv_profile.ts:109` reads the `badges_job_seeker` column);
      it just needs threading onto the collected profile, the same way
      `fullName` was threaded for the collector's name-based URL matching.
      Worth doing before any campaign leans on open-to-work as a real signal.
      Note the badge is self-reported and often stale, so it is evidence for
      the model rather than a candidate for a hard cut.
- [ ] Update `README.md`'s architecture section once Bebity is live in
      production, not just the benchmark path.

## Concurrency

Resolved. `APIFY_BATCH_CONCURRENCY` (shared, in `apify_profile_collector/
config.ts`) was tuned specifically for HarvestAPI's own queue behavior (429s
above 15 concurrent Actor runs on a 6-run baseline) — that number is
provider-specific and stays at 6 for Harvest.

A separate paid benchmark against `collectBebityProfiles` directly (bypassing
Harvest) swept concurrency 6/10/15 at batch sizes 10 and 50, on the full
Bebity-eligible test pool (189 profiles — the practical ceiling of available
test data). Zero failures, retries, or unexpected records at every level
tested (see `output/benchmarks/bebity/`, runs `fa44d159`, `ba4abe9e`,
`c4366d8e`, `8acf7fbd`). No ceiling was found within that data budget, so 15
was picked as Bebity's own default (`resolveBebityConcurrency`,
`BEBITY_BATCH_CONCURRENCY`) rather than the true safe maximum — a bigger
eligible-profile pool would be needed to push the sweep further, and the
batch-size-50 run only ever achieved ~4-way real concurrency (189 profiles /
50 per batch), not genuine 15-way — that combination (concurrency 15 at
batch size 50, the actual production shape once volumes exceed ~750
profiles) is still unverified. Apify's account-wide Actor concurrency cap
(35 on the current "Started" plan) is a separate, unrelated ceiling.
