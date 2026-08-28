import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dbDeleteProfile,
  dbGetEvaluationRunById,
  dbGetProfileById,
  dbInsertEvaluationRun,
  dbInsertProfile,
  dbListEvaluationRuns,
  dbListProfiles,
  openDatabase,
} from '../index.js';
import type { StoredEvaluationRun } from '../index.js';
import type { FullProfile } from '../../profile/index.js';

/** Builds the minimum complete profile needed by database tests. */
function profile(
  id: string,
  linkedinUrl: string,
  headline?: string,
): FullProfile {
  return {
    id,
    linkedinUrl,
    ...(headline ? { headline } : {}),
    experience: [],
    education: [],
    raw: { linkedinUrl },
  };
}

/** Builds one compact evaluation run for persistence tests. */
function evaluationRun(
  id: string,
  createdAt: string,
  systemPrompt: string,
): StoredEvaluationRun {
  return {
    id,
    createdAt,
    criteria: { systemPrompt },
    evaluation: {
      broadFilter: {
        profilesForAi: [],
        evaluations: [],
      },
      modelEvaluation: {
        requestedProfiles: 0,
        successfulProfiles: 0,
        failedProfiles: 0,
        evaluations: [],
        failures: [],
        tokenUsage: {
          promptTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0,
          totalTokens: 0,
        },
      },
    },
  };
}

test('inserts one profile into the initialized database', () => {
  const db = openDatabase(':memory:');

  try {
    const inserted = dbInsertProfile(
      profile('profile-id', 'https://linkedin.com/in/example-profile'),
      db,
    );
    const row = db
      .prepare('SELECT id, linkedin_key FROM profiles')
      .get() as { id: string; linkedin_key: string };

    assert.equal(inserted.id, 'profile-id');
    assert.equal(row.id, 'profile-id');
    assert.equal(row.linkedin_key, 'example-profile');
  } finally {
    db.close();
  }
});

test('preserves the exact Linked Helper public ID in profile JSON', () => {
  const db = openDatabase(':memory:');
  const linkedHelperPublicId = 'Exact-CSV-Public-ID';

  try {
    const stored = dbInsertProfile(
      {
        ...profile('profile-id', 'https://linkedin.com/in/example-profile'),
        linkedHelperPublicId,
      },
      db,
    );
    const retrieved = dbGetProfileById(stored.id, db);

    assert.equal(retrieved?.linkedHelperPublicId, linkedHelperPublicId);
  } finally {
    db.close();
  }
});

test('updates a repeated LinkedIn profile without replacing its ID', () => {
  const db = openDatabase(':memory:');

  try {
    dbInsertProfile(
      profile('stable-id', 'https://linkedin.com/in/example-profile'),
      db,
    );
    const updated = dbInsertProfile(
      profile(
        'new-random-id',
        'https://br.linkedin.com/in/EXAMPLE-PROFILE/?trk=search',
        'Updated headline',
      ),
      db,
    );
    const row = db
      .prepare('SELECT id, profile_json FROM profiles')
      .get() as { id: string; profile_json: string };
    const storedProfile = JSON.parse(row.profile_json) as FullProfile;

    assert.equal(updated.id, 'stable-id');
    assert.equal(row.id, 'stable-id');
    assert.equal(storedProfile.id, 'stable-id');
    assert.equal(storedProfile.headline, 'Updated headline');
  } finally {
    db.close();
  }
});

test('deletes a profile by ID and reports whether it existed', () => {
  const db = openDatabase(':memory:');

  try {
    const inserted = dbInsertProfile(
      profile('profile-id', 'https://linkedin.com/in/example-profile'),
      db,
    );

    assert.equal(dbDeleteProfile(inserted, db), true);
    assert.equal(dbDeleteProfile(inserted, db), false);
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM profiles')
      .get() as { count: number };
    assert.equal(row.count, 0);
  } finally {
    db.close();
  }
});

test('gets a profile by ID and reports an absent profile', () => {
  const db = openDatabase(':memory:');

  try {
    const inserted = dbInsertProfile(
      profile(
        'profile-id',
        'https://linkedin.com/in/example-profile',
        'Stored headline',
      ),
      db,
    );

    assert.deepEqual(dbGetProfileById(inserted.id, db), inserted);
    assert.equal(dbGetProfileById('missing-profile-id', db), undefined);
  } finally {
    db.close();
  }
});

test('lists all profiles in their original insertion order', () => {
  const db = openDatabase(':memory:');

  try {
    const first = dbInsertProfile(
      profile('first-id', 'https://linkedin.com/in/first-profile'),
      db,
    );
    const second = dbInsertProfile(
      profile('second-id', 'https://linkedin.com/in/second-profile'),
      db,
    );

    assert.deepEqual(dbListProfiles(db), [first, second]);
  } finally {
    db.close();
  }
});

test('stores and retrieves a complete evaluation run', () => {
  const db = openDatabase(':memory:');

  try {
    const run = evaluationRun(
      'evaluation-run-id',
      '2026-08-27T10:00:00.000Z',
      'Evaluate the supplied campaign profiles.',
    );

    assert.deepEqual(dbInsertEvaluationRun(run, db), run);
    assert.deepEqual(dbGetEvaluationRunById(run.id, db), run);
    assert.equal(dbGetEvaluationRunById('missing-run-id', db), undefined);
  } finally {
    db.close();
  }
});

test('preserves evaluation history and lists the newest run first', () => {
  const db = openDatabase(':memory:');

  try {
    const older = evaluationRun(
      'older-run',
      '2026-08-26T10:00:00.000Z',
      'Use the earlier campaign criteria.',
    );
    const newer = evaluationRun(
      'newer-run',
      '2026-08-27T10:00:00.000Z',
      'Use the later campaign criteria.',
    );

    dbInsertEvaluationRun(older, db);
    dbInsertEvaluationRun(newer, db);

    assert.deepEqual(dbListEvaluationRuns(db), [newer, older]);
  } finally {
    db.close();
  }
});
