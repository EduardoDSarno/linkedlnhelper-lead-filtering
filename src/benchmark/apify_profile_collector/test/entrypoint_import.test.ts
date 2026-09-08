import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const IMPORT_TIMEOUT_MS = 15_000;

/** Guards against imports launching either benchmark's CLI lifecycle. */
test('benchmark entry points have no CLI side effects when imported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-import-'));
  const require = createRequire(import.meta.url);
  const entries = [
    new URL('../index.ts', import.meta.url).href,
    new URL('../../bebity_profile_collector/index.ts', import.meta.url).href,
  ];
  try {
    execFileSync(process.execPath, [
      '--import', pathToFileURL(require.resolve('tsx')).href,
      '--input-type=module', '-e',
      entries.map(entry => `await import(${JSON.stringify(entry)});`).join('\n'),
    ], { cwd: directory, timeout: IMPORT_TIMEOUT_MS, stdio: 'pipe' });
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
