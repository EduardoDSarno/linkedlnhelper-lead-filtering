import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeProfileImages,
  attachSuccessfulImageAnalyses,
  imageConcurrencyFromEnvironment,
  totalImageTokenUsage,
} from '../image_analysis.js';
import type { ProfileImageAnalyzer } from '../image_analysis.js';
import { PROFILE_IMAGE_DEFAULTS } from '../../image_extractor/index.js';
import type { ProfileImageJobResult } from '../../image_extractor/index.js';
import type { Profile } from '../../profile/index.js';
import {
  imageExtractionResult,
  recordingLogger,
} from '../../test_support/pipeline_fakes.js';

/** Builds a normalized profile, with a photo unless one is explicitly absent. */
function profile(id: string, photo?: string | undefined): Profile {
  return {
    id,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    experience: [],
    education: [],
    raw: {},
    ...(photo === undefined ? {} : { photo }),
  };
}

/** An analyzer that fulfils every job it is given. */
const fulfilEveryJob: ProfileImageAnalyzer = async (jobs) =>
  jobs.map((job) => ({
    id: job.id,
    status: 'fulfilled' as const,
    result: imageExtractionResult({ model: `model-for-${job.id}` }),
  }));

/** Runs one case with a temporarily replaced environment variable. */
async function withEnvironment(
  value: string | undefined,
  run: () => void | Promise<void>,
): Promise<void> {
  const key = 'IMAGE_ANALYSIS_CONCURRENCY';
  const previous = process.env[key];

  if (value === undefined) delete process.env[key];
  else process.env[key] = value;

  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('creates a job only for profiles that have a photo', async () => {
  const seen: string[] = [];
  const analyzer: ProfileImageAnalyzer = async (jobs) => {
    seen.push(...jobs.map((job) => job.id));
    return fulfilEveryJob(jobs, {});
  };

  const outcome = await analyzeProfileImages(
    [
      profile('with-photo', 'https://example.invalid/a.jpg'),
      profile('no-photo'),
      profile('blank-photo', ''),
      profile('also-with-photo', 'https://example.invalid/b.jpg'),
    ],
    analyzer,
    recordingLogger(),
    4,
  );

  // A blank photo string is the same as no photo: it cannot be fetched.
  assert.deepEqual(seen, ['with-photo', 'also-with-photo']);
  assert.equal(outcome.profilesWithoutPhoto, 2);
});

test('sends the photo URL as the job source', async () => {
  let sources: unknown[] = [];
  const analyzer: ProfileImageAnalyzer = async (jobs) => {
    sources = jobs.map((job) => job.source);
    return fulfilEveryJob(jobs, {});
  };

  await analyzeProfileImages(
    [profile('a', 'https://example.invalid/a.jpg')],
    analyzer,
    recordingLogger(),
    1,
  );

  assert.deepEqual(sources, [
    { kind: 'url', url: 'https://example.invalid/a.jpg' },
  ]);
});

test('keeps every profile, analyzed or not', async () => {
  const outcome = await analyzeProfileImages(
    [
      profile('a', 'https://example.invalid/a.jpg'),
      profile('b'),
      profile('c', 'https://example.invalid/c.jpg'),
    ],
    async (jobs) =>
      jobs.map((job) =>
        job.id === 'c'
          ? {
              id: job.id,
              status: 'rejected' as const,
              error: 'Gemini is unavailable.',
            }
          : {
              id: job.id,
              status: 'fulfilled' as const,
              result: imageExtractionResult(),
            },
      ),
    recordingLogger(),
    2,
  );

  // One analyzed, one without a photo, one failed: all three survive.
  assert.deepEqual(
    outcome.fullProfiles.map((item) => item.id),
    ['a', 'b', 'c'],
  );
  assert.ok(outcome.fullProfiles[0]?.imageAnalysis);
  assert.equal('imageAnalysis' in (outcome.fullProfiles[1] ?? {}), false);
  assert.equal('imageAnalysis' in (outcome.fullProfiles[2] ?? {}), false);
});

test('counts successes and failures separately', async () => {
  const outcome = await analyzeProfileImages(
    [
      profile('a', 'https://example.invalid/a.jpg'),
      profile('b', 'https://example.invalid/b.jpg'),
      profile('c', 'https://example.invalid/c.jpg'),
    ],
    async (jobs) =>
      jobs.map((job, index) =>
        index === 0
          ? {
              id: job.id,
              status: 'fulfilled' as const,
              result: imageExtractionResult(),
            }
          : {
              id: job.id,
              status: 'rejected' as const,
              error: 'The profile image is empty.',
            },
      ),
    recordingLogger(),
    3,
  );

  assert.equal(outcome.successfulImageAnalyses, 1);
  assert.equal(outcome.failedImageAnalyses, 2);
  assert.deepEqual(
    outcome.failures.map((failure) => failure.profileId),
    ['b', 'c'],
  );
});

test('carries billed usage onto a reported failure', async () => {
  const outcome = await analyzeProfileImages(
    [profile('a', 'https://example.invalid/a.jpg')],
    async (jobs) =>
      jobs.map((job) => ({
        id: job.id,
        status: 'rejected' as const,
        error: 'Gemini blocked the image request: SAFETY.',
        usage: { promptTokens: 70, totalTokens: 70 },
      })),
    recordingLogger(),
    1,
  );

  assert.deepEqual(outcome.failures[0]?.usage, {
    promptTokens: 70,
    totalTokens: 70,
  });
});

test('omits usage from a failure that reported none', async () => {
  const outcome = await analyzeProfileImages(
    [profile('a', 'https://example.invalid/a.jpg')],
    async (jobs) =>
      jobs.map((job) => ({
        id: job.id,
        status: 'rejected' as const,
        error: 'The profile image is empty.',
      })),
    recordingLogger(),
    1,
  );

  assert.equal('usage' in (outcome.failures[0] ?? {}), false);
});

test('analyzes nothing when no profile has a photo', async () => {
  let calls = 0;
  const outcome = await analyzeProfileImages(
    [profile('a'), profile('b')],
    async (jobs) => {
      calls += 1;
      assert.deepEqual(jobs, []);
      return [];
    },
    recordingLogger(),
    5,
  );

  // The analyzer is still called once, with nothing to do, so a caller cannot
  // accidentally depend on it being skipped.
  assert.equal(calls, 1);
  assert.equal(outcome.profilesWithoutPhoto, 2);
  assert.equal(outcome.fullProfiles.length, 2);
  assert.deepEqual(outcome.tokenUsage, {
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  });
});

test('handles an empty profile list', async () => {
  const outcome = await analyzeProfileImages(
    [],
    fulfilEveryJob,
    recordingLogger(),
    1,
  );

  assert.deepEqual(outcome.fullProfiles, []);
  assert.equal(outcome.profilesWithoutPhoto, 0);
  assert.equal(outcome.successfulImageAnalyses, 0);
});

test('passes the requested concurrency and resolution to the analyzer', async () => {
  const seen: unknown[] = [];
  const analyzer: ProfileImageAnalyzer = async (jobs, options) => {
    seen.push(options);
    return fulfilEveryJob(jobs, options);
  };

  await analyzeProfileImages(
    [profile('a', 'https://example.invalid/a.jpg')],
    analyzer,
    recordingLogger(),
    6,
  );

  assert.deepEqual(seen, [{ concurrency: 6, resolution: 'medium' }]);
});

test('reads the environment when no concurrency is supplied', async () => {
  await withEnvironment('4', async () => {
    const seen: unknown[] = [];

    await analyzeProfileImages(
      [profile('a', 'https://example.invalid/a.jpg')],
      async (jobs, options) => {
        seen.push(options);
        return fulfilEveryJob(jobs, options);
      },
      recordingLogger(),
    );

    assert.deepEqual(seen, [{ concurrency: 4, resolution: 'medium' }]);
  });
});

test('prefers an explicit concurrency over the environment', async () => {
  await withEnvironment('4', async () => {
    const seen: unknown[] = [];

    await analyzeProfileImages(
      [profile('a', 'https://example.invalid/a.jpg')],
      async (jobs, options) => {
        seen.push(options);
        return fulfilEveryJob(jobs, options);
      },
      recordingLogger(),
      9,
    );

    assert.deepEqual(seen, [{ concurrency: 9, resolution: 'medium' }]);
  });
});

test('logs the stage start, each failure, and the stage total', async () => {
  const logger = recordingLogger();

  await analyzeProfileImages(
    [
      profile('a', 'https://example.invalid/a.jpg'),
      profile('b', 'https://example.invalid/b.jpg'),
      profile('c'),
    ],
    async (jobs) =>
      jobs.map((job, index) =>
        index === 0
          ? {
              id: job.id,
              status: 'fulfilled' as const,
              result: imageExtractionResult(),
            }
          : {
              id: job.id,
              status: 'rejected' as const,
              error: 'Gemini is unavailable.',
            },
      ),
    logger,
    2,
  );

  const messages = logger.entries.map((entry) => entry.message);
  assert.ok(messages.includes('Starting profile image analysis.'));
  assert.ok(messages.includes('Completed profile image analysis.'));

  // Every failure gets its own warning so an operator can see which profile.
  const warnings = logger.entries.filter((entry) => entry.level === 'warn');
  assert.equal(warnings.length, 1);
  assert.equal(
    (warnings[0]?.payload as { profileId: string }).profileId,
    'b',
  );
});

test('totalImageTokenUsage sums both result branches', () => {
  const results: ProfileImageJobResult[] = [
    {
      id: 'a',
      status: 'fulfilled',
      result: imageExtractionResult({
        usage: {
          promptTokens: 10,
          outputTokens: 2,
          thinkingTokens: 3,
          totalTokens: 15,
        },
      }),
    },
    {
      id: 'b',
      status: 'rejected',
      error: 'blocked',
      usage: { promptTokens: 5, totalTokens: 5 },
    },
    { id: 'c', status: 'rejected', error: 'no usage reported' },
    { id: 'd', status: 'fulfilled', result: imageExtractionResult() },
  ];

  // Absent counts contribute zero rather than making the total undefined.
  assert.deepEqual(totalImageTokenUsage(results), {
    promptTokens: 15,
    outputTokens: 2,
    thinkingTokens: 3,
    totalTokens: 20,
  });
});

test('totalImageTokenUsage returns zeroes for no results', () => {
  assert.deepEqual(totalImageTokenUsage([]), {
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  });
});

test('attachSuccessfulImageAnalyses joins by ID, not by position', () => {
  const profiles = [profile('a'), profile('b'), profile('c')];
  const results: ProfileImageJobResult[] = [
    {
      id: 'c',
      status: 'fulfilled',
      result: imageExtractionResult({ model: 'for-c' }),
    },
    {
      id: 'a',
      status: 'fulfilled',
      result: imageExtractionResult({ model: 'for-a' }),
    },
  ];

  const joined = attachSuccessfulImageAnalyses(profiles, results);

  assert.equal(joined[0]?.imageAnalysis?.model, 'for-a');
  assert.equal('imageAnalysis' in (joined[1] ?? {}), false);
  assert.equal(joined[2]?.imageAnalysis?.model, 'for-c');
});

test('attachSuccessfulImageAnalyses does not mutate the input profiles', () => {
  const original = profile('a');
  const joined = attachSuccessfulImageAnalyses(
    [original],
    [{ id: 'a', status: 'fulfilled', result: imageExtractionResult() }],
  );

  assert.equal('imageAnalysis' in original, false);
  assert.notEqual(joined[0], original);
});

test('imageConcurrencyFromEnvironment reads a usable value', async () => {
  for (const [value, expected] of [
    ['1', 1],
    ['8', 8],
    ['50', 50],
    ['7.9', 7],
  ] as const) {
    await withEnvironment(value, () => {
      assert.equal(imageConcurrencyFromEnvironment(), expected);
    });
  }
});

test('imageConcurrencyFromEnvironment defaults when the value is not a number', async () => {
  // A missing or unparseable variable carries no information, so it is treated
  // the same as not setting one at all.
  for (const value of [undefined, 'not a number']) {
    await withEnvironment(value, () => {
      assert.equal(
        imageConcurrencyFromEnvironment(),
        PROFILE_IMAGE_DEFAULTS.batchConcurrency,
      );
    });
  }
});

test('imageConcurrencyFromEnvironment clamps a numeric value into range', async () => {
  // A real number that is out of range is clamped rather than discarded: the
  // operator asked for something specific, just not something legal.
  for (const [value, expected] of [
    ['0', 1],
    ['-3', 1],
    ['500', 50],
  ] as const) {
    await withEnvironment(value, () => {
      assert.equal(imageConcurrencyFromEnvironment(), expected);
    });
  }
});

test('imageConcurrencyFromEnvironment defaults an empty variable', () => {
  assert.equal(
    imageConcurrencyFromEnvironment({ IMAGE_ANALYSIS_CONCURRENCY: '' }),
    PROFILE_IMAGE_DEFAULTS.batchConcurrency,
  );
});
