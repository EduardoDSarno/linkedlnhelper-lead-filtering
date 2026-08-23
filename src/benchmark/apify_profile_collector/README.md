# Apify profile collector benchmark

This command validates the production Apify collector independently from
profile mapping, Linked Helper normalization, and Gemini image analysis. The
collector receives a list of LinkedIn profile links regardless of how those
links enter the benchmark. Every experiment is written to an isolated output
directory.

## Input choices

For the simplest test, pass one or more links directly. Repeat `--url` for each
profile:

```text
npm run benchmark:apify -- --url <linkedin-url> --url <linkedin-url>
```

The benchmark also accepts a small input file:

- `.txt`: one LinkedIn profile URL per non-empty line;
- `.json`: an array of URL strings, or objects with a supported URL field;
- `.csv`: a header plus a supported URL column;
- a Linked Helper `.csv`: detected automatically, but only its URL and optional
  name columns are read by this benchmark.

Supported object and CSV URL headers are `linkedinUrl`, `linkedin_url`,
`profileUrl`, `profile_url`, and `url`. Optional expected-name headers are
`fullName`, `full_name`, `name`, `firstName`, `first_name`, `lastName`, and
`last_name`.

This means a CSV is not required. A minimal CSV can contain only:

```csv
linkedinUrl
https://www.linkedin.com/in/example
```

If names are available, they are compared with successful Apify results as an
advisory identity check. A name mismatch is recorded in `summary.json`, but it
does not change collection validation because formatting and name variations
can be legitimate.

## Separation from the full pipeline

The production collector itself already accepts links directly:

```ts
const result = await collectApifyProfiles(profileLinks, logger, options);
```

It has no CSV dependency. The full application pipeline may continue using the
Linked Helper importer to obtain its initial profiles, while this benchmark's
input adapters produce only `profileLinks` and optional expected names before
calling the same collector.

## Paid-call safeguard

Dry-run mode is the default. The command does not construct the Apify client or
call HarvestAPI unless `--execute` is explicitly present.

Preview a benchmark without provider calls:

```text
npm run benchmark:apify -- <input-file> --dry-run --limit <profile-count>
```

Perform the planned paid collection:

```text
npm run benchmark:apify -- <input-file> --execute --limit <profile-count>
```

Direct links use the same execution safeguards:

```text
npm run benchmark:apify -- --url <linkedin-url> --execute
```

Every Actor run started in execute mode is billed according to the active
Apify and HarvestAPI pricing. The flag only prevents accidental execution; it
does not make any provider request free.

## Options

| Option | Purpose |
| --- | --- |
| `--url <linkedin-url>` | Adds a direct profile link; repeat for more links. |
| `--execute` | Authorizes paid Apify collection. |
| `--dry-run` | Explicitly selects the default no-provider-call mode. |
| `--offset <number>` | Skips unique profiles before selection. |
| `--limit <number>` | Limits profiles selected after the offset. |
| `--label <text>` | Adds a human-readable scenario label. |
| `--batch-size <number>` | Overrides profiles per Actor run. |
| `--concurrency <number>` | Overrides simultaneous Actor runs. |
| `--max-attempts <number>` | Overrides the per-profile attempt budget. |

Collector overrides are validated by the production collector configuration.
Values above its safety ceilings are clamped. When overrides are omitted, the
source of truth is `src/data/apify_profile_collector/config.ts`.
The tested production baseline and its benchmark evidence are documented in
`src/data/apify_profile_collector/PHASE_1_CONFIGURATION.md`.

## Selection behavior

The runner cleans and deduplicates LinkedIn URLs before applying `--offset` and
`--limit`. This makes non-overlapping benchmark segments stable and prevents
duplicate URLs in the same input from consuming selection positions.

## Artifacts

Each invocation generates a unique run ID and writes beneath:

```text
output/benchmarks/apify/{runId}/
```

Dry runs write:

```text
plan.json
summary.json
benchmark.log
```

Paid executions additionally write:

```text
profiles.json
failures.json
```

`plan.json` records the exact selected profile links, resolved collector
settings, expected initial Actor runs, and expected scheduling waves. It is
written before any provider call.

`summary.json` records the terminal status, collection statistics, artifact
paths, reconciliation checks, and optional source-name comparisons.

## Result validation

The benchmark checks that:

- aggregate collection counts reconcile;
- successful profile URLs are unique;
- failure URLs are unique;
- no profile appears in successes and failures;
- every selected input has a success or final failure;
- no result URL was absent from the selected input;
- the provider returned no unexpected records.

Normal provider failures such as unavailable profiles do not fail the
benchmark when they are correctly reported. Lost, duplicated, overlapping, or
unexpected results produce `invariant_failed` and a failing process exit code.

Fatal authentication, collection, or artifact errors produce `fatal` and a
failing process exit code. The runner attempts to persist the fatal summary
before returning the error.

## Suggested validation sequence

1. Preview the selected subset in dry-run mode.
2. Execute a small smoke test.
3. Execute one complete configured batch.
4. Validate the plan's concurrency using smaller batches.
5. Execute a representative production-shaped run.
6. Scale to the full configured workload only after earlier reports reconcile.

Use disjoint offsets where possible so successive paid benchmarks do not
collect and bill the same profiles repeatedly.
