import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  dbDeleteCriteriaPreset,
  dbListCriteriaPresets,
  dbSaveCriteriaPreset,
  initializeDatabase,
} from '../index.js';

/** Opens an isolated in-memory database with the current schema. */
function openTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  initializeDatabase(db);
  return db;
}

test('stores the form exactly as given and reads it back', () => {
  const db = openTestDatabase();
  const form = { ideal: 'Perfil ideal', ageMin: 25, exclusions: ['trainee'] };

  const saved = dbSaveCriteriaPreset({ id: 'preset-1', name: 'Eldorado', form }, db);

  assert.equal(saved.name, 'Eldorado');
  assert.deepEqual(saved.form, form);
  assert.deepEqual(dbListCriteriaPresets(db)[0]?.form, form);
  db.close();
});

test('saving under an existing name updates it instead of adding a duplicate', () => {
  const db = openTestDatabase();
  dbSaveCriteriaPreset({ id: 'preset-1', name: 'Eldorado', form: { ideal: 'v1' } }, db);

  const updated = dbSaveCriteriaPreset(
    { id: 'preset-2', name: 'Eldorado', form: { ideal: 'v2' } },
    db,
  );
  const presets = dbListCriteriaPresets(db);

  assert.equal(presets.length, 1);
  assert.deepEqual(presets[0]?.form, { ideal: 'v2' });
  // The original row survives, so a dropdown selection by id stays valid.
  assert.equal(updated.id, 'preset-1');
  db.close();
});

test('lists the most recently updated preset first', () => {
  const db = openTestDatabase();
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1)));

  dbSaveCriteriaPreset({ id: 'a', name: 'Primeiro', form: {} }, db, clock);
  dbSaveCriteriaPreset({ id: 'b', name: 'Segundo', form: {} }, db, clock);

  assert.deepEqual(
    dbListCriteriaPresets(db).map((preset) => preset.name),
    ['Segundo', 'Primeiro'],
  );
  db.close();
});

test('reports whether a delete removed anything', () => {
  const db = openTestDatabase();
  dbSaveCriteriaPreset({ id: 'preset-1', name: 'Eldorado', form: {} }, db);

  assert.equal(dbDeleteCriteriaPreset('missing', db), false);
  assert.equal(dbDeleteCriteriaPreset('preset-1', db), true);
  assert.equal(dbListCriteriaPresets(db).length, 0);
  db.close();
});
