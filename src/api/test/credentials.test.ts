import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyCredentials,
  credentialsStatus,
  forgetCredentials,
  loadRememberedCredentials,
} from '../credentials.js';

const OPENROUTER_KEY = 'OPENROUTER_API_KEY';

/**
 * Runs one case against a clean environment and storage.
 *
 * The module writes remembered keys beside the database, so each case runs
 * from the repository root in a temp directory and restores whatever the
 * developer's own environment held.
 */
function withCleanCredentials(run: () => void): void {
  const previous = {
    openRouter: process.env[OPENROUTER_KEY],
    cwd: process.cwd(),
  };
  const directory = mkdtempSync(join(tmpdir(), 'credentials-'));

  delete process.env[OPENROUTER_KEY];
  process.chdir(directory);

  try {
    run();
  } finally {
    process.chdir(previous.cwd);
    rmSync(directory, { recursive: true, force: true });

    if (previous.openRouter === undefined) delete process.env[OPENROUTER_KEY];
    else process.env[OPENROUTER_KEY] = previous.openRouter;
  }
}

test('reports nothing configured before any key arrives', () => {
  withCleanCredentials(() => {
    const status = credentialsStatus();

    assert.equal(status.ready, false);
    assert.equal(status.openRouter.configured, false);
  });
});

test('puts a submitted key into the environment the pipeline reads', () => {
  withCleanCredentials(() => {
    // The model client reads process.env per call, so this is what makes a
    // key pasted in the browser reach it without a restart.
    const status = applyCredentials({ openRouter: 'openrouter-token' }, false);

    assert.equal(process.env[OPENROUTER_KEY], 'openrouter-token');
    assert.equal(status.ready, true);
    assert.equal(status.openRouter.tail, 'oken');
    assert.equal(status.openRouter.remembered, false);
  });
});

test('keeps a remembered key across a restart, and forgets one that is not', () => {
  withCleanCredentials(() => {
    applyCredentials({ openRouter: 'kept-router' }, true);
    assert.equal(credentialsStatus().openRouter.remembered, true);

    // Standing in for a restart: the process forgets, the file does not.
    delete process.env[OPENROUTER_KEY];
    assert.equal(credentialsStatus().ready, false);

    loadRememberedCredentials();
    assert.equal(process.env[OPENROUTER_KEY], 'kept-router');
    assert.equal(credentialsStatus().ready, true);

    forgetCredentials();
    delete process.env[OPENROUTER_KEY];
    loadRememberedCredentials();

    assert.equal(credentialsStatus().ready, false);
  });
});

test('lets a configured environment win over a remembered key', () => {
  withCleanCredentials(() => {
    applyCredentials({ openRouter: 'remembered' }, true);
    delete process.env[OPENROUTER_KEY];

    // A key set in .env or the shell is this process's explicit instruction,
    // so it must not be overwritten by what a browser saved earlier.
    process.env[OPENROUTER_KEY] = 'from-environment';
    loadRememberedCredentials();

    assert.equal(process.env[OPENROUTER_KEY], 'from-environment');
  });
});

test('replaces the held key when a new one is submitted', () => {
  withCleanCredentials(() => {
    applyCredentials({ openRouter: 'first-router' }, false);
    applyCredentials({ openRouter: 'second-router' }, false);

    assert.equal(process.env[OPENROUTER_KEY], 'second-router');
  });
});
