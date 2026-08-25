import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dbDeleteProfile,
  dbGetProfileById,
  dbInsertProfile,
  dbListProfiles,
  openDatabase,
} from '../index.js';
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
