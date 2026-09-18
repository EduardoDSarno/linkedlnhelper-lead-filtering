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

const APIFY_KEY = 'APIFY_API_KEY';
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
    apify: process.env[APIFY_KEY],
    openRouter: process.env[OPENROUTER_KEY],
    cwd: process.cwd(),
  };
  const directory = mkdtempSync(join(tmpdir(), 'credentials-'));

  delete process.env[APIFY_KEY];
  delete process.env[OPENROUTER_KEY];
  process.chdir(directory);

  try {
    run();
  } finally {
    process.chdir(previous.cwd);
    rmSync(directory, { recursive: true, force: true });

    if (previous.apify === undefined) delete process.env[APIFY_KEY];
    else process.env[APIFY_KEY] = previous.apify;

    if (previous.openRouter === undefined) delete process.env[OPENROUTER_KEY];
    else process.env[OPENROUTER_KEY] = previous.openRouter;
  }
}

test('reports nothing configured before any key arrives', () => {
  withCleanCredentials(() => {
    const status = credentialsStatus();

    assert.equal(status.ready, false);
    assert.equal(status.apify.configured, false);
    assert.equal(status.openRouter.configured, false);
  });
});

test('puts submitted keys into the environment the pipeline reads', () => {
  withCleanCredentials(() => {
    // Both consumers read process.env per call, so this is what makes a key
    // pasted in the browser reach them without a restart.
    const status = applyCredentials(
      { apify: 'apify-token', openRouter: 'openrouter-token' },
      false,
    );

    assert.equal(process.env[APIFY_KEY], 'apify-token');
    assert.equal(process.env[OPENROUTER_KEY], 'openrouter-token');
    assert.equal(status.ready, true);
    assert.equal(status.apify.tail, 'oken');
    assert.equal(status.apify.remembered, false);
  });
});

test('keeps a remembered key across a restart, and forgets one that is not', () => {
  withCleanCredentials(() => {
    applyCredentials({ apify: 'kept-apify', openRouter: 'kept-router' }, true);
    assert.equal(credentialsStatus().apify.remembered, true);

    // Standing in for a restart: the process forgets, the file does not.
    delete process.env[APIFY_KEY];
    delete process.env[OPENROUTER_KEY];
    assert.equal(credentialsStatus().ready, false);

    loadRememberedCredentials();
    assert.equal(process.env[APIFY_KEY], 'kept-apify');
    assert.equal(credentialsStatus().ready, true);

    forgetCredentials();
    delete process.env[APIFY_KEY];
    delete process.env[OPENROUTER_KEY];
    loadRememberedCredentials();

    assert.equal(credentialsStatus().ready, false);
  });
});

test('lets a configured environment win over a remembered key', () => {
  withCleanCredentials(() => {
    applyCredentials({ apify: 'remembered', openRouter: 'remembered' }, true);
    delete process.env[APIFY_KEY];
    delete process.env[OPENROUTER_KEY];

    // A key set in .env or the shell is this process's explicit instruction,
    // so it must not be overwritten by what a browser saved earlier.
    process.env[APIFY_KEY] = 'from-environment';
    loadRememberedCredentials();

    assert.equal(process.env[APIFY_KEY], 'from-environment');
    assert.equal(process.env[OPENROUTER_KEY], 'remembered');
  });
});

test('replaces only the key that was resubmitted', () => {
  withCleanCredentials(() => {
    applyCredentials({ apify: 'first-apify', openRouter: 'first-router' }, false);
    applyCredentials({ openRouter: 'second-router' }, false);

    assert.equal(process.env[APIFY_KEY], 'first-apify');
    assert.equal(process.env[OPENROUTER_KEY], 'second-router');
  });
});
