# LinkedIn lead funnel

A system that takes a LinkedIn search and runs the funnel up to a phone number
and a booked meeting, per client LinkedIn account: find people, fetch their
profiles, judge each one against criteria the client describes in plain
language, send the connection request, run the follow-up messages, and pull
the phone number out of the reply.

**Status: being rebuilt.** v1 screened LinkedHelper CSV exports and was used
in production until 2026-09-29. This branch keeps only the parts the funnel
reuses and grows the rest from one account up.

- Goals: [`docs/VISION.md`](docs/VISION.md)
- Research and decisions behind them: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- v1's measured baseline: [`docs/SNAPSHOT.md`](docs/SNAPSHOT.md)

## What is here now

| Module | Role |
| --- | --- |
| `src/evaluation/` | Judges a profile against the client's criteria with an LLM: prompt, response schema, retries, decision policy. |
| `src/models/` | Provider-neutral model client, with the OpenRouter adapter. |
| `src/dataCollector/apify_profile_collector/` | Harvest profile scraper on Apify, used to fill gaps in profile data. |
| `src/mapper/`, `src/profile/` | The app's own profile model and the mapping into it. |
| `src/imageExtractor/` | Downloads profile photos for the evaluation request. |
| `src/linkedin/`, `src/helpers/`, `src/logging/` | Shared utilities. |

Still to build: the Unipile client, webhooks, the scheduler that owns
per-account limits, and the lead pipeline that ties them together.

## Where v1 went

Nothing was deleted from history.

- `handoff-local-app` branch: every v1 commit plus the Windows package.
- Tag `v1.0-windows`: the Windows build handed to the operator.
- Tag `linked_leadv1.0-no_downloaed_package`: v1's final state without it.
- Tag `v1.0.0-mvp`: the baseline `docs/SNAPSHOT.md` describes.

## Development

Requires Node 22 or newer.

```bash
npm install
cp .env.example .env   # fill in APIFY_API_KEY and OPENROUTER_API_KEY
npm test               # type-check and unit tests
```

Tests never call a paid service; model and Apify calls are injected.
