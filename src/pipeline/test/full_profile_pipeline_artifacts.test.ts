import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeJsonAtomically } from '../../helpers/write_json_atomically.js';
import { runFullProfilePipelineWithDependencies } from '../full_profile_pipeline.js';
import type { FullProfilePipelineOutputPaths } from '../full_profile_pipeline.js';
import {
  RAW_ONLY_SENTINEL,
  completeApifyProfile,
} from '../../test_support/apify_profile_fixtures.js';
import {
  apifyCollectionResult,
  imageExtractionResult,
  importedCsvDataFor,
  recordingLogger,
  steppingClock,
} from '../../test_support/pipeline_fakes.js';

/**
 * End-to-end artifact coverage using the real atomic writer and a real
 * directory.
 *
 * The other pipeline tests inject an in-memory writer, which is what makes
 * write order and object identity observable. That fake cannot show what
 * `JSON.stringify` does to the artifacts, so this file writes real files and
 * reads them back: it is the only place proving the summary survives
 * serialization and that the production writer is still wired in.
 *
 * Everything stays inside a temporary directory that is removed afterward.
 */

/** Runs one case in a temporary directory that is always removed after. */
async function withTemporaryOutput(
  run: (
    directory: string,
    outputPaths: FullProfilePipelineOutputPaths,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'full-profile-pipeline-'));

  try {
    await run(directory, {
      rawApifyProfiles: join(directory, 'apify-profiles.json'),
      apifyProfileFailures: join(directory, 'apify-profile-failures.json'),
      fullProfiles: join(directory, 'full-profiles.json'),
      summary: join(directory, 'pipeline-summary.json'),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Reads one artifact back from disk. */
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('writes real artifacts that survive a JSON round trip', async () => {
  await withTemporaryOutput(async (directory, outputPaths) => {
    const urls = [
      'https://www.linkedin.com/in/person-a',
      'https://www.linkedin.com/in/person-b',
    ];
    const raw = { ...completeApifyProfile(), linkedinUrl: urls[0] };
    const providerFailure = {
      linkedinUrl: urls[1] ?? '',
      category: 'not_found',
      message: 'The profile no longer exists.',
      attempts: 1,
    };

    const summary = await runFullProfilePipelineWithDependencies(
      importedCsvDataFor(urls),
      recordingLogger(),
      {
        collectProfiles: async () =>
          apifyCollectionResult([raw], [providerFailure] as never),
        extractImages: async (jobs) =>
          jobs.map((job) => ({
            id: job.id,
            status: 'fulfilled' as const,
            result: imageExtractionResult({
              usage: { promptTokens: 90, totalTokens: 120 },
            }),
          })),
        writeJson: writeJsonAtomically,
        now: steppingClock('2026-04-01T09:00:00.000Z', 2_000),
      },
      { outputPaths },
    );

    // Exactly the four configured artifacts, and no temporary file left over.
    assert.deepEqual((await readdir(directory)).sort(), [
      'apify-profile-failures.json',
      'apify-profiles.json',
      'full-profiles.json',
      'pipeline-summary.json',
    ]);

    // The summary returned in memory and the summary on disk must agree. A
    // value that JSON cannot represent would silently differ here.
    const persistedSummary = await readJson(outputPaths.summary);
    assert.deepEqual(persistedSummary, JSON.parse(JSON.stringify(summary)));
    assert.deepEqual(persistedSummary, summary);
  });
});

test('persists the raw provider payload through serialization', async () => {
  await withTemporaryOutput(async (_directory, outputPaths) => {
    const url = 'https://www.linkedin.com/in/person-a';
    const raw = { ...completeApifyProfile(), linkedinUrl: url };

    await runFullProfilePipelineWithDependencies(
      importedCsvDataFor([url]),
      recordingLogger(),
      {
        collectProfiles: async () => apifyCollectionResult([raw]),
        extractImages: async (jobs) =>
          jobs.map((job) => ({
            id: job.id,
            status: 'fulfilled' as const,
            result: imageExtractionResult(),
          })),
        writeJson: writeJsonAtomically,
        now: steppingClock(),
      },
      { outputPaths },
    );

    const profiles = (await readJson(outputPaths.fullProfiles)) as {
      raw: Record<string, unknown>;
      imageAnalysis?: unknown;
    }[];

    // Identity cannot survive a file, so this checks the weaker but still
    // meaningful property: no provider field was lost on the way to disk.
    assert.equal(
      profiles[0]?.raw[RAW_ONLY_SENTINEL],
      'provider-only value the mapper must not touch',
    );
    assert.deepEqual(profiles[0]?.raw, raw);
    assert.ok(profiles[0]?.imageAnalysis);
  });
});

test('writes provider failures and raw profiles to separate files', async () => {
  await withTemporaryOutput(async (_directory, outputPaths) => {
    const urls = [
      'https://www.linkedin.com/in/person-a',
      'https://www.linkedin.com/in/person-b',
    ];
    const providerFailure = {
      linkedinUrl: urls[1] ?? '',
      category: 'rate_limited',
      message: 'Too many requests.',
      attempts: 3,
    };

    await runFullProfilePipelineWithDependencies(
      importedCsvDataFor(urls),
      recordingLogger(),
      {
        collectProfiles: async () =>
          apifyCollectionResult(
            [{ linkedinUrl: urls[0], firstName: 'Avery' }],
            [providerFailure] as never,
          ),
        extractImages: async () => [],
        writeJson: writeJsonAtomically,
        now: steppingClock(),
      },
      { outputPaths },
    );

    assert.deepEqual(await readJson(outputPaths.apifyProfileFailures), [
      providerFailure,
    ]);
    assert.deepEqual(await readJson(outputPaths.rawApifyProfiles), [
      { linkedinUrl: urls[0], firstName: 'Avery' },
    ]);
  });
});

test('leaves no summary on disk when an earlier artifact fails', async () => {
  await withTemporaryOutput(async (directory, outputPaths) => {
    const url = 'https://www.linkedin.com/in/person-a';

    await assert.rejects(
      () =>
        runFullProfilePipelineWithDependencies(
          importedCsvDataFor([url]),
          recordingLogger(),
          {
            collectProfiles: async () =>
              apifyCollectionResult([{ linkedinUrl: url }]),
            extractImages: async () => [],
            writeJson: async (path, value) => {
              if (path === outputPaths.fullProfiles) {
                throw new Error('The disk is full.');
              }
              await writeJsonAtomically(path, value);
            },
            now: steppingClock(),
          },
          { outputPaths },
        ),
      /The disk is full/,
    );

    // A summary on disk means the run finished. It must be absent here.
    const written = await readdir(directory);
    assert.equal(written.includes('pipeline-summary.json'), false);
    assert.equal(written.includes('full-profiles.json'), false);
  });
});
