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

- [ ] Export `resolveBrazilRegion` (or equivalent) from `brazil_location.ts`.
- [ ] Write `parseBebityLocation(raw: string)` in the Bebity adapter, producing
      Harvest-shaped `location`.
- [ ] Test against real samples already in
      `output/benchmarks/bebity/*/profiles.json` and `test_data/*.csv`
      (`location_name` column has the same flat format — useful as extra
      parser test fixtures even though it isn't the data source in production).

## Remaining TODOs

- [ ] Write `adaptBebityRawProfile(raw)` implementing the field map above
      (rename + date parsing + location parsing), returning a Harvest-shaped
      `RawApifyProfile`.
- [ ] Wire a real (non-benchmark) Bebity collector that: partitions input via
      `partitionProfileLinksForBebity`, calls Bebity for the compatible slice,
      calls the existing Harvest collector for the rest, adapts Bebity raw
      records, and merges both result sets before they reach `mapApifyProfile`.
- [ ] Add `config.ts` for Bebity (mirroring `apify_profile_collector/config.ts`):
      batch size, concurrency, retry/backoff, sourced from env with safety
      ceilings — see the `.env.example` concurrency note below.
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
- [ ] Update `README.md`'s architecture section once Bebity is live in
      production, not just the benchmark path.

## Concurrency

`APIFY_BATCH_CONCURRENCY` (in `apify_profile_collector/config.ts`) was tuned
specifically for HarvestAPI's own queue behavior (429s above 15 concurrent
Actor runs on a 6-run baseline) — that number is provider-specific, not an
Apify platform ceiling, and should not be reused for Bebity as-is.

Apify itself also caps how many Actor runs can be in flight at once,
account-wide, based on the subscription plan. On the current plan ("Started"),
up to 35 concurrent Actor runs are allowed — this is an Apify account limit,
separate from whatever concurrency Bebity's own actor can tolerate before
erroring or degrading. That has not been benchmarked yet (see the paid
Harvest benchmark table in `APIFY_COLLECTOR_CONFIG.md` for the kind of test
this needs before picking a production default). `BEBITY_BATCH_CONCURRENCY`
is documented in `.env.example` as a placeholder; it is not consumed by any
code yet — that lands with the `config.ts` TODO above.
