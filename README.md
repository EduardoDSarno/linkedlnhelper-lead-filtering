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

`src/` is grouped by role, so each part of the funnel gets its own folder
beside these as it is built.

| Folder | Role |
| --- | --- |
| `src/evaluation/` | Judges a profile against the client's criteria with an LLM: prompt, response schema, retries, decision policy. `photos/` downloads the profile photo sent with the request. |
| `src/llm/` | Provider-neutral model client with the OpenRouter adapter. Shared: evaluation uses it now; writing messages and reading replies will too. |
| `src/profiles/` | The profile model every stage passes around, and the mapping into it. `sources/harvest/` fetches full profiles from Harvest on Apify to fill gaps. |
| `src/linkedin/` | The vendor-neutral `LinkedinProvider` interface (connect link, account country, search, profile, invitation), with the Unipile adapter in `unipile/`. Nothing outside this folder imports a vendor SDK. |
| `src/shared/` | Helpers, logging, and test support used across the codebase. |

Still to build: webhooks, the scheduler that owns
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
cp .env.example .env   # fill in the API keys and the Unipile workspace
npm test               # type-check and unit tests
```

Tests never call a paid service; model and Apify calls are injected.
