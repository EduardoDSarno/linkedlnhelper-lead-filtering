# Deferred Scaling Work

The MVP may use Gemini to make evidence-based regional-presence estimates from
the compact profile evaluation context. The work below is intentionally
postponed until real usage, cost, and accuracy data justify it.

## Deterministic Regional Presence

- Normalize job-location aliases for campaign cities and nearby municipalities.
- Build dated work and education intervals for a configured region.
- Merge overlapping intervals before calculating cumulative known regional time.
- Return explicit evidence and insufficient-data results instead of guessing.

## University Location Lookup

- Create a SQLite lookup table from the Brazilian e-MEC institution list.
- Import the catalog independently from profile collection.
- Match LinkedIn school names against official names and acronyms.
- Treat missing, ambiguous, multi-campus, and remote-study matches as unknown.
- Use a matched institution location only as regional-presence evidence.

## AI Cost And Reliability

- Measure real token usage from compact evaluation contexts.
- Send profiles to Gemini only when deterministic evidence is incomplete or
  ambiguous.
- Cache repeat evaluations when the profile and campaign configuration have not
  changed.
- Compare AI estimates with reviewer decisions before relying on them more
  broadly.

## Configuration Operations

- Persist named campaign evaluation configurations in SQLite.
- Add configuration validation and a user-facing selection interface.
- Record evaluation outcomes and reviewer feedback for later calibration.
