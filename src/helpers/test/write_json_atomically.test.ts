import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeJsonAtomically } from '../write_json_atomically.js';

/** Runs one case inside a temporary directory that is always removed after. */
async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'write-json-atomically-'));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('writes formatted JSON that reads back as the original value', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'value.json');
    const value = { name: 'Avery', tags: ['a', 'b'], nested: { count: 2 } };

    await writeJsonAtomically(path, value);

    const contents = await readFile(path, 'utf8');
    assert.deepEqual(JSON.parse(contents), value);

    // Two-space indentation keeps written artifacts reviewable by hand.
    assert.ok(contents.includes('\n  "name": "Avery"'));
  });
});

test('creates missing parent directories', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'nested', 'deeper', 'value.json');

    await writeJsonAtomically(path, { ok: true });

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ok: true });
  });
});

test('leaves no temporary file behind after a successful write', async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeJsonAtomically(join(directory, 'value.json'), { ok: true });

    // The rename must consume the temporary file; a leftover .tmp would be
    // collected by any later directory listing of the output folder.
    assert.deepEqual(await readdir(directory), ['value.json']);
  });
});

test('replaces an existing file rather than appending to it', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'value.json');
    await writeFile(path, JSON.stringify({ previous: true }), 'utf8');

    await writeJsonAtomically(path, { replaced: true });

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      replaced: true,
    });
  });
});

test('writes arrays and empty collections', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'list.json');

    await writeJsonAtomically(path, []);

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), []);
  });
});

test('propagates serialization failures without leaving a destination file', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'circular.json');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    await assert.rejects(() => writeJsonAtomically(path, circular));

    // The destination must not exist: a reader should never observe a file
    // created by a write that failed.
    assert.equal((await readdir(directory)).includes('circular.json'), false);
  });
});
