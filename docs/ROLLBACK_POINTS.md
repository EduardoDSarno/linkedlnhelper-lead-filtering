# Rollback points

Commits worth returning to, newest first. Each one is a working state of the
app on the `handoff-local-app` branch.

## Last version that collects profiles through Apify

**Commit:** `ddb55c9` (`ddb55c9afe5ddd5850fc71f906fe2f77986edb75`)
**Date:** 2026-10-05

The full pipeline as the client used it: upload a LinkedHelper CSV, collect
each profile through Apify (Bebity, with Harvest as fallback), then filter and
evaluate with OpenRouter. Includes the installer, the delete-route fix and the
optional `ACCESS_PASSWORD`.

The commits after it replace Apify with profiles read straight from the
LinkedHelper "Perfis baixados" export.

To look at it without changing anything:

```bash
git checkout ddb55c9
```

To go back to `handoff-local-app` afterwards:

```bash
git checkout handoff-local-app
```

To start a branch from it (for example to ship the Apify version again):

```bash
git checkout -b apify-version ddb55c9
```

## First version in real use

**Tag:** `v1.0.0-mvp` (commit `9ae91cb`). See `SNAPSHOT.md`.
