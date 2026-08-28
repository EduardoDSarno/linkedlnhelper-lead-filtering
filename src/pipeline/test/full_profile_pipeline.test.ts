import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PIPELINE_PROFILES,
  runFullProfilePipelineWithDependencies,
} from '../full_profile_pipeline.js';
import type {
  FullProfilePipelineDependencies,
  FullProfilePipelineOutputPaths,
} from '../full_profile_pipeline.js';
import type { FullProfile } from '../../profile/index.js';
import { dbInsertProfile, openDatabase } from '../../database/index.js';
import {
  RAW_ONLY_SENTINEL,
  completeApifyProfile,
} from '../../test_support/apify_profile_fixtures.js';
import {
  apifyCollectionResult,
  fakeImageExtractor,
  imageExtractionResult,
  importedCsvDataFor,
  recordingLogger,
  recordingWriter,
  steppingClock,
} from '../../test_support/pipeline_fakes.js';
import type { RecordingWriter } from '../../test_support/pipeline_fakes.js';

const OUTPUT_PATHS: FullProfilePipelineOutputPaths = {
  rawApifyProfiles: 'test-output/apify-profiles.json',
  apifyProfileFailures: 'test-output/apify-profile-failures.json',
  fullProfiles: 'test-output/full-profiles.json',
  summary: 'test-output/pipeline-summary.json',
};

/** Builds a provider record for one URL, with an optional photo. */
function providerProfile(
  url: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    linkedinUrl: url,
    firstName: 'Avery',
    lastName: 'Stone',
    photo: `https://example.invalid/${url.split('/').pop()}.jpg`,
    ...fields,
  };
}

/**
 * Builds dependencies whose provider and image analyzer fail the test if used
 * unexpectedly, so an accidental real call is impossible to miss.
 */
function dependencies(
  overrides: Partial<FullProfilePipelineDependencies> = {},
): FullProfilePipelineDependencies {
  return {
    collectProfiles: async () => {
      throw new Error('The pipeline called the provider unexpectedly.');
    },
    extractImages: async () => {
      throw new Error('The pipeline called the image analyzer unexpectedly.');
    },
    writeJson: async () => {
      throw new Error('The pipeline wrote an artifact unexpectedly.');
    },
    openDatabase: () => openDatabase(':memory:'),
    insertProfile: dbInsertProfile,
    now: steppingClock(),
    ...overrides,
  };
}

/** Reads the full profiles an artifact write captured. */
function fullProfilesFrom(writer: RecordingWriter): FullProfile[] {
  return writer.valueAt(OUTPUT_PATHS.fullProfiles) as FullProfile[];
}

test('processes a mixed run and reconciles every total', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
    'https://www.linkedin.com/in/person-c',
    'https://www.linkedin.com/in/person-d',
    'https://www.linkedin.com/in/person-e',
  ];

  // person-a succeeds with a good image, person-b succeeds but its image is
  // rejected, person-c has no photo, person-d is malformed and fails mapping,
  // person-e never came back from the provider at all.
  const collection = apifyCollectionResult(
    [
      { ...completeApifyProfile(), linkedinUrl: urls[0] },
      providerProfile(urls[1] ?? ''),
      providerProfile(urls[2] ?? '', { photo: '' }),
      { firstName: 'No', lastName: 'Identity' },
    ],
    [
      {
        linkedinUrl: urls[4] ?? '',
        category: 'not_found',
        message: 'The profile no longer exists.',
        attempts: 1,
      },
    ] as never,
  );

  const writer = recordingWriter();
  const logger = recordingLogger();

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    logger,
    dependencies({
      collectProfiles: async () => collection,
      extractImages: async (jobs) => {
        // Only profiles that actually have a photo may reach the analyzer.
        assert.equal(jobs.length, 2);
        return jobs.map((job, index) =>
          index === 0
            ? {
                id: job.id,
                status: 'fulfilled' as const,
                result: imageExtractionResult({
                  usage: { promptTokens: 100, totalTokens: 150 },
                }),
              }
            : {
                id: job.id,
                status: 'rejected' as const,
                error: 'Gemini blocked the image request: SAFETY.',
                usage: { promptTokens: 40, totalTokens: 40 },
              },
        );
      },
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS, imageConcurrency: 2 },
  );

  assert.equal(summary.requestedProfiles, 5);
  assert.equal(summary.collectedProfiles, 4);
  assert.equal(summary.normalizedProfiles, 3);
  assert.equal(summary.mappingFailures.length, 1);
  assert.equal(summary.mappingFailures[0]?.providerRecordIndex, 3);
  assert.match(summary.mappingFailures[0]?.error ?? '', /without linkedinUrl/);
  assert.equal(summary.profilesWithoutPhoto, 1);
  assert.equal(summary.successfulImageAnalyses, 1);
  assert.equal(summary.failedImageAnalyses, 1);
  assert.equal(summary.fullProfilesWritten, 3);
  assert.equal(summary.providerFailures.length, 1);

  const imageLogs = logger.entries.filter(
    (entry) => entry.message === 'Profile image analysis outcome.',
  );
  assert.equal(imageLogs.length, 3);
  const failedImageLog = imageLogs.find(
    (entry) =>
      (entry.payload as Record<string, unknown>)['status'] === 'failed',
  );
  assert.ok(failedImageLog);
  assert.equal(
    (failedImageLog.payload as Record<string, unknown>)['linkedinUrl'],
    urls[1],
  );
  assert.match(
    String((failedImageLog.payload as Record<string, unknown>)['reason']),
    /SAFETY/,
  );

  // Every profile that mapped survives to the output, including the one whose
  // image failed and the one that never had a photo.
  assert.equal(
    summary.normalizedProfiles,
    summary.fullProfilesWritten,
    'a normalized profile disappeared before the final output',
  );
});

test('attaches an assessment only to the profile it belongs to', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
  ];
  const writer = recordingWriter();

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([
          providerProfile(urls[0] ?? ''),
          providerProfile(urls[1] ?? ''),
        ]),
      extractImages: async (jobs) => [
        {
          id: jobs[0]?.id ?? '',
          status: 'fulfilled',
          result: imageExtractionResult({ model: 'for-person-a' }),
        },
        {
          id: jobs[1]?.id ?? '',
          status: 'rejected',
          error: 'The profile image is empty.',
        },
      ],
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  const profiles = fullProfilesFrom(writer);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0]?.imageAnalysis?.model, 'for-person-a');
  assert.equal('imageAnalysis' in (profiles[1] ?? {}), false);
});

test('joins image results by profile ID, not by position', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
    'https://www.linkedin.com/in/person-c',
  ];
  const writer = recordingWriter();

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult(urls.map((url) => providerProfile(url))),
      extractImages: async (jobs) => {
        // Return results in reverse order. A pipeline that joined by index
        // would attach each assessment to the wrong profile.
        const identified = jobs.map((job) => ({
          id: job.id,
          status: 'fulfilled' as const,
          result: imageExtractionResult({ model: `model-for-${job.id}` }),
        }));
        return identified.reverse();
      },
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  for (const profile of fullProfilesFrom(writer)) {
    assert.equal(profile.imageAnalysis?.model, `model-for-${profile.id}`);
  }
});

test('keeps the raw provider payload reachable through the final profile', async () => {
  const url = 'https://www.linkedin.com/in/person-a';
  const raw = { ...completeApifyProfile(), linkedinUrl: url };
  const writer = recordingWriter();

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () => apifyCollectionResult([raw]),
      extractImages: fakeImageExtractor({}),
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  const profile = fullProfilesFrom(writer)[0];
  assert.equal(profile?.raw, raw);
  assert.equal(
    (profile?.raw as Record<string, unknown>)[RAW_ONLY_SENTINEL],
    'provider-only value the mapper must not touch',
  );
});

test('returns and writes profiles with their database-stable IDs', async () => {
  const url = 'https://www.linkedin.com/in/person-a';
  const db = openDatabase(':memory:');
  const writer = recordingWriter();
  const stableId = 'stable-profile-id';
  const insertedProfiles: FullProfile[] = [];

  dbInsertProfile(
    {
      id: stableId,
      linkedinUrl: url,
      experience: [],
      education: [],
      raw: { linkedinUrl: url },
    },
    db,
  );

  const result = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(url)]),
      extractImages: fakeImageExtractor({}),
      writeJson: writer.writeJson,
      openDatabase: () => db,
      insertProfile: (profile, database) => {
        const inserted = dbInsertProfile(profile, database);
        insertedProfiles.push(inserted);
        return inserted;
      },
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.equal(insertedProfiles[0]?.id, stableId);
  assert.equal(result.profiles[0]?.id, stableId);
  assert.equal(fullProfilesFrom(writer)[0]?.id, stableId);
  assert.equal(db.isOpen, false);
});

test('stops and closes the database when a profile upsert fails', async () => {
  const url = 'https://www.linkedin.com/in/person-a';
  const db = openDatabase(':memory:');
  const writer = recordingWriter();

  await assert.rejects(
    () =>
      runFullProfilePipelineWithDependencies(
        importedCsvDataFor([url]),
        recordingLogger(),
        dependencies({
          collectProfiles: async () =>
            apifyCollectionResult([providerProfile(url)]),
          extractImages: fakeImageExtractor({}),
          writeJson: writer.writeJson,
          openDatabase: () => db,
          insertProfile: () => {
            throw new Error('SQLite is unavailable.');
          },
        }),
        { outputPaths: OUTPUT_PATHS },
      ),
    /SQLite is unavailable/,
  );

  assert.equal(writer.paths().includes(OUTPUT_PATHS.fullProfiles), false);
  assert.equal(writer.paths().includes(OUTPUT_PATHS.summary), false);
  assert.equal(db.isOpen, false);
});

test('totals token usage across successful and failed images', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
  ];

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult(urls.map((url) => providerProfile(url))),
      extractImages: async (jobs) => [
        {
          id: jobs[0]?.id ?? '',
          status: 'fulfilled',
          result: imageExtractionResult({
            usage: {
              promptTokens: 100,
              outputTokens: 20,
              thinkingTokens: 30,
              totalTokens: 150,
            },
          }),
        },
        {
          id: jobs[1]?.id ?? '',
          status: 'rejected',
          error: 'Gemini blocked the image request: SAFETY.',
          usage: { promptTokens: 60, totalTokens: 60 },
        },
      ],
      writeJson: recordingWriter().writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  // The blocked image was billed, so its tokens belong in the total.
  assert.deepEqual(summary.imageTokenUsage, {
    promptTokens: 160,
    outputTokens: 20,
    thinkingTokens: 30,
    totalTokens: 210,
  });
  assert.deepEqual(summary.imageAnalysisFailures[0]?.usage, {
    promptTokens: 60,
    totalTokens: 60,
  });
});

test('reports zero token usage when nothing reported any', async () => {
  const url = 'https://www.linkedin.com/in/person-a';

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(url)]),
      extractImages: async (jobs) => [
        {
          id: jobs[0]?.id ?? '',
          status: 'fulfilled',
          result: imageExtractionResult(),
        },
      ],
      writeJson: recordingWriter().writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.deepEqual(summary.imageTokenUsage, {
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  });
});

test('writes the summary after every other artifact', async () => {
  const url = 'https://www.linkedin.com/in/person-a';
  const writer = recordingWriter();

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(url)]),
      extractImages: fakeImageExtractor({}),
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  // The summary existing is what signals a completed run, so it must be last.
  assert.equal(writer.paths().at(-1), OUTPUT_PATHS.summary);
  assert.deepEqual(new Set(writer.paths()), new Set(Object.values(OUTPUT_PATHS)));
});

test('writes raw profiles and provider failures as separate artifacts', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
  ];
  const failures = [
    {
      linkedinUrl: urls[1] ?? '',
      category: 'not_found',
      message: 'The profile no longer exists.',
      attempts: 1,
    },
  ];
  const writer = recordingWriter();

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult(
          [providerProfile(urls[0] ?? '')],
          failures as never,
        ),
      extractImages: fakeImageExtractor({}),
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  const rawWritten = writer.valueAt(OUTPUT_PATHS.rawApifyProfiles) as unknown[];
  const failuresWritten = writer.valueAt(OUTPUT_PATHS.apifyProfileFailures);

  assert.equal(rawWritten.length, 1);
  assert.deepEqual(failuresWritten, failures);
});

test('uses the injected clock for both timestamps and the duration', async () => {
  const url = 'https://www.linkedin.com/in/person-a';

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(url)]),
      extractImages: fakeImageExtractor({}),
      writeJson: recordingWriter().writeJson,
      now: steppingClock('2026-03-01T12:00:00.000Z', 5_000),
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.equal(summary.startedAt, '2026-03-01T12:00:00.000Z');
  assert.equal(summary.completedAt, '2026-03-01T12:00:05.000Z');
  assert.equal(summary.durationMs, 5_000);
});

test('reports the configured output paths in the summary', async () => {
  const url = 'https://www.linkedin.com/in/person-a';

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(url)]),
      extractImages: fakeImageExtractor({}),
      writeJson: recordingWriter().writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.deepEqual(summary.outputs, OUTPUT_PATHS);
});

test('rejects an empty import before calling the provider', async () => {
  let providerCalls = 0;

  await assert.rejects(
    () =>
      runFullProfilePipelineWithDependencies(
        importedCsvDataFor([]),
        recordingLogger(),
        dependencies({
          collectProfiles: async () => {
            providerCalls += 1;
            return apifyCollectionResult([]);
          },
        }),
        { outputPaths: OUTPUT_PATHS },
      ),
    /does not contain any LinkedIn URLs/,
  );

  assert.equal(providerCalls, 0);
});

test('rejects an oversized import before calling the provider', async () => {
  let providerCalls = 0;
  const urls = Array.from(
    { length: MAX_PIPELINE_PROFILES + 1 },
    (_unused, index) => `https://www.linkedin.com/in/person-${index}`,
  );

  await assert.rejects(
    () =>
      runFullProfilePipelineWithDependencies(
        importedCsvDataFor(urls),
        recordingLogger(),
        dependencies({
          collectProfiles: async () => {
            providerCalls += 1;
            return apifyCollectionResult([]);
          },
        }),
        { outputPaths: OUTPUT_PATHS },
      ),
    /accepts at most/,
  );

  assert.equal(providerCalls, 0);
});

test('analyzes no images when no profile has a photo', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
  ];
  const writer = recordingWriter();
  let analyzerCalls = 0;

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult(
          urls.map((url) => providerProfile(url, { photo: '' })),
        ),
      extractImages: async (jobs) => {
        analyzerCalls += 1;
        assert.deepEqual(jobs, []);
        return [];
      },
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.equal(analyzerCalls, 1);
  assert.equal(summary.profilesWithoutPhoto, 2);
  assert.equal(summary.successfulImageAnalyses, 0);
  assert.equal(summary.fullProfilesWritten, 2);
});

test('keeps every profile when all image analyses fail', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
  ];
  const writer = recordingWriter();

  const { summary } = await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult(urls.map((url) => providerProfile(url))),
      extractImages: async (jobs) =>
        jobs.map((job) => ({
          id: job.id,
          status: 'rejected' as const,
          error: 'Gemini is unavailable.',
        })),
      writeJson: writer.writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.equal(summary.failedImageAnalyses, 2);
  assert.equal(summary.fullProfilesWritten, 2);
  assert.ok(
    fullProfilesFrom(writer).every(
      (profile) => !('imageAnalysis' in profile),
    ),
  );
});

test('passes the configured image concurrency to the analyzer', async () => {
  const url = 'https://www.linkedin.com/in/person-a';
  const seen: unknown[] = [];

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor([url]),
    recordingLogger(),
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(url)]),
      extractImages: async (jobs, options) => {
        seen.push(options);
        return jobs.map((job) => ({
          id: job.id,
          status: 'fulfilled' as const,
          result: imageExtractionResult(),
        }));
      },
      writeJson: recordingWriter().writeJson,
    }),
    { outputPaths: OUTPUT_PATHS, imageConcurrency: 7 },
  );

  assert.deepEqual(seen, [{ concurrency: 7, resolution: 'medium' }]);
});

test('surfaces an artifact write failure', async () => {
  const url = 'https://www.linkedin.com/in/person-a';
  const writer = recordingWriter({
    path: OUTPUT_PATHS.fullProfiles,
    error: new Error('The disk is full.'),
  });

  await assert.rejects(
    () =>
      runFullProfilePipelineWithDependencies(
        importedCsvDataFor([url]),
        recordingLogger(),
        dependencies({
          collectProfiles: async () =>
            apifyCollectionResult([providerProfile(url)]),
          extractImages: fakeImageExtractor({}),
          writeJson: writer.writeJson,
        }),
        { outputPaths: OUTPUT_PATHS },
      ),
    /The disk is full/,
  );

  // The summary must not appear when an earlier artifact failed, otherwise its
  // presence would wrongly signal a complete run.
  assert.equal(writer.paths().includes(OUTPUT_PATHS.summary), false);
});

test('warns when the provider returns a different number of profiles', async () => {
  const urls = [
    'https://www.linkedin.com/in/person-a',
    'https://www.linkedin.com/in/person-b',
  ];
  const logger = recordingLogger();

  await runFullProfilePipelineWithDependencies(
    importedCsvDataFor(urls),
    logger,
    dependencies({
      collectProfiles: async () =>
        apifyCollectionResult([providerProfile(urls[0] ?? '')]),
      extractImages: async (jobs) =>
        jobs.map((job) => ({
          id: job.id,
          status: 'fulfilled' as const,
          result: imageExtractionResult(),
        })),
      writeJson: recordingWriter().writeJson,
    }),
    { outputPaths: OUTPUT_PATHS },
  );

  assert.ok(
    logger.entries.some(
      (entry) =>
        entry.level === 'warn' &&
        entry.message.includes('differs from requested profile count'),
    ),
  );
});
