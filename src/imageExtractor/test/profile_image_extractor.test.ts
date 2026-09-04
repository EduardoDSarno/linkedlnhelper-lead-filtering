import assert from 'node:assert/strict';
import test from 'node:test';

import { GeminiImageError } from '../gemini_profile_image_client.js';
import {
  extractProfileImages,
  extractProfileImagesWithExecutor,
} from '../profile_image_extractor.js';
import type { ProfileImageExecutor } from '../profile_image_extractor.js';
import type {
  ProfileImageExtractionResult,
  ProfileImageJob,
} from '../profile_image_types.js';
import { validImageAssessment } from '../../test_support/image_assessment_fixtures.js';

/** Builds jobs whose source URL encodes the job ID, for easy correlation. */
function jobs(count: number): ProfileImageJob[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `profile-${index}`,
    source: { kind: 'url', url: `https://images.invalid/${index}.png` },
  }));
}

/** Builds a successful result tagged with the model name given. */
function extractionResult(model: string): ProfileImageExtractionResult {
  return {
    assessment: validImageAssessment(),
    model,
    resolution: 'medium',
  };
}

/** Resolves after the current round of pending microtasks and timers. */
async function tick(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('returns an empty result without calling the executor', async () => {
  let calls = 0;
  const executor: ProfileImageExecutor = async () => {
    calls += 1;
    return extractionResult('unused');
  };

  const results = await extractProfileImagesWithExecutor([], executor);

  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test('preserves input order when jobs finish out of order', async () => {
  // The first job is the slowest, so completion order is the reverse of input
  // order. Position in the result array must still follow the input.
  const delaysById: Record<string, number> = {
    'profile-0': 30,
    'profile-1': 20,
    'profile-2': 10,
    'profile-3': 0,
  };
  const completionOrder: string[] = [];

  const executor: ProfileImageExecutor = async (source) => {
    const url = source.kind === 'url' ? source.url : '';
    const id = `profile-${url.match(/(\d+)\.png$/)?.[1] ?? '?'}`;
    await tick(delaysById[id] ?? 0);
    completionOrder.push(id);
    return extractionResult(id);
  };

  const results = await extractProfileImagesWithExecutor(jobs(4), executor, {
    concurrency: 4,
  });

  assert.deepEqual(
    results.map((result) => result.id),
    ['profile-0', 'profile-1', 'profile-2', 'profile-3'],
  );

  // Guard the guard: if everything happened to finish in input order, the
  // ordering assertion above would prove nothing.
  assert.notDeepEqual(
    completionOrder,
    ['profile-0', 'profile-1', 'profile-2', 'profile-3'],
  );
});

test('correlates each result with its own job', async () => {
  const executor: ProfileImageExecutor = async (source) => {
    const url = source.kind === 'url' ? source.url : '';
    return extractionResult(url);
  };

  const results = await extractProfileImagesWithExecutor(jobs(3), executor);

  for (const [index, result] of results.entries()) {
    assert.equal(result.id, `profile-${index}`);
    assert.equal(result.status, 'fulfilled');
    assert.equal(
      result.status === 'fulfilled' ? result.result.model : undefined,
      `https://images.invalid/${index}.png`,
    );
  }
});

test('one failed image does not cancel the others', async () => {
  const executor: ProfileImageExecutor = async (source) => {
    const url = source.kind === 'url' ? source.url : '';

    if (url.endsWith('1.png')) {
      throw new Error('That image could not be read.');
    }

    return extractionResult(url);
  };

  const results = await extractProfileImagesWithExecutor(jobs(4), executor);

  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
  );
  assert.equal(
    results[1]?.status === 'rejected' ? results[1].error : undefined,
    'That image could not be read.',
  );
});

test('reports every job when they all fail', async () => {
  const executor: ProfileImageExecutor = async () => {
    throw new Error('Gemini is unavailable.');
  };

  const results = await extractProfileImagesWithExecutor(jobs(3), executor);

  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.status === 'rejected'));
});

test('stringifies a thrown value that is not an Error', async () => {
  const executor: ProfileImageExecutor = async () => {
    throw 'a bare string';
  };

  const results = await extractProfileImagesWithExecutor(jobs(1), executor);

  assert.equal(
    results[0]?.status === 'rejected' ? results[0].error : undefined,
    'a bare string',
  );
});

test('carries billed token usage onto a rejected result', async () => {
  // A blocked image is still charged. Losing the usage here is what would make
  // failed images invisible in a cost total.
  const executor: ProfileImageExecutor = async () => {
    throw new GeminiImageError('Gemini blocked the image request: SAFETY.', {
      promptTokens: 300,
      totalTokens: 300,
    });
  };

  const results = await extractProfileImagesWithExecutor(jobs(1), executor);
  const result = results[0];

  assert.equal(result?.status, 'rejected');
  assert.deepEqual(
    result?.status === 'rejected' ? result.usage : undefined,
    { promptTokens: 300, totalTokens: 300 },
  );
});

test('retains billed usage when Gemini returns invalid structured JSON', async () => {
  const promptTokens = 240;
  const totalTokens = 260;
  const results = await extractProfileImages(
    [
      {
        id: 'invalid-structured-output',
        source: {
          kind: 'bytes',
          data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          mimeType: 'image/png',
        },
      },
    ],
    {
      generateContent: async () => ({
        text: '{not valid json',
        usage: {
          promptTokens,
          totalTokens,
        },
      }),
    },
  );

  assert.deepEqual(results, [
    {
      id: 'invalid-structured-output',
      status: 'rejected',
      error: 'Gemini returned malformed JSON for the image assessment.',
      usage: { promptTokens, totalTokens },
    },
  ]);
});

test('omits usage when the failure carried none', async () => {
  const executor: ProfileImageExecutor = async () => {
    throw new Error('The profile image is empty.');
  };

  const results = await extractProfileImagesWithExecutor(jobs(1), executor);
  const result = results[0];

  assert.equal(result?.status, 'rejected');
  assert.equal(
    result?.status === 'rejected' ? 'usage' in result : true,
    false,
  );
});

test('never exceeds the configured concurrency', async () => {
  let active = 0;
  let peak = 0;

  const executor: ProfileImageExecutor = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick(5);
    active -= 1;
    return extractionResult('done');
  };

  await extractProfileImagesWithExecutor(jobs(20), executor, {
    concurrency: 3,
  });

  assert.equal(peak, 3);
});

test('clamps concurrency to the module ceiling', async () => {
  let active = 0;
  let peak = 0;

  const executor: ProfileImageExecutor = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick(1);
    active -= 1;
    return extractionResult('done');
  };

  await extractProfileImagesWithExecutor(jobs(80), executor, {
    concurrency: 5_000,
  });

  // MAX_BATCH_CONCURRENCY is the hard ceiling regardless of what is requested.
  assert.equal(peak, 50);
});

test('clamps a too-small concurrency to a single worker', async () => {
  for (const concurrency of [0, -4, 0.4]) {
    let active = 0;
    let peak = 0;

    const executor: ProfileImageExecutor = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(1);
      active -= 1;
      return extractionResult('done');
    };

    await extractProfileImagesWithExecutor(jobs(4), executor, { concurrency });

    assert.equal(peak, 1, `expected concurrency ${concurrency} to run serially`);
  }
});

test('falls back to the default when concurrency is not a number', async () => {
  // A non-finite value once survived the clamp all the way to the worker
  // count, which started no workers and returned an empty slot for every job.
  let active = 0;
  let peak = 0;
  let completed = 0;

  const executor: ProfileImageExecutor = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick(2);
    active -= 1;
    completed += 1;
    return extractionResult('done');
  };

  const results = await extractProfileImagesWithExecutor(
    jobs(60),
    executor,
    { concurrency: Number.NaN },
  );

  // Every job must run, and the pool must be the module default.
  assert.equal(completed, 60);
  assert.equal(peak, 25);
  assert.equal(results.length, 60);
  assert.ok(results.every((result) => result.status === 'fulfilled'));
});

test('returns a result for every job, never an empty slot', async () => {
  for (const concurrency of [undefined, Number.NaN, 0, 1, 3, 5_000]) {
    const results = await extractProfileImagesWithExecutor(
      jobs(6),
      async () => extractionResult('done'),
      concurrency === undefined ? {} : { concurrency },
    );

    assert.equal(results.length, 6);
    assert.ok(
      results.every((result) => result !== undefined && result.id !== ''),
      `concurrency ${String(concurrency)} left an empty slot`,
    );
  }
});

test('starts no more workers than there are jobs', async () => {
  let active = 0;
  let peak = 0;

  const executor: ProfileImageExecutor = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick(5);
    active -= 1;
    return extractionResult('done');
  };

  await extractProfileImagesWithExecutor(jobs(2), executor, {
    concurrency: 25,
  });

  assert.equal(peak, 2);
});

test('passes the extraction options through and withholds concurrency', async () => {
  const seen: unknown[] = [];
  const executor: ProfileImageExecutor = async (_source, options) => {
    seen.push(options);
    return extractionResult('done');
  };

  await extractProfileImagesWithExecutor(jobs(1), executor, {
    concurrency: 4,
    model: 'configured-model',
    resolution: 'high',
    requestTimeoutMs: 1_234,
    maxRetries: 1,
  });

  // Concurrency belongs to the batch, not to a single image, so it must not
  // leak into the per-image options.
  assert.deepEqual(seen, [
    {
      model: 'configured-model',
      resolution: 'high',
      requestTimeoutMs: 1_234,
      maxRetries: 1,
    },
  ]);
});

test('runs every job exactly once', async () => {
  const seen: string[] = [];
  const executor: ProfileImageExecutor = async (source) => {
    seen.push(source.kind === 'url' ? source.url : '');
    await tick(1);
    return extractionResult('done');
  };

  await extractProfileImagesWithExecutor(jobs(30), executor, {
    concurrency: 7,
  });

  assert.equal(seen.length, 30);
  assert.equal(new Set(seen).size, 30);
});
