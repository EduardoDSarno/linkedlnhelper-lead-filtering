import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadProfileImage } from '../profile_image_loader.js';
import type { ProfileImageLoadingOptions } from '../profile_image_loader.js';

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

/**
 * Builds loading options with a fetch that fails the test if it is called.
 *
 * Every non-remote case uses this, so a source that accidentally starts
 * downloading is caught immediately instead of silently reaching the network.
 */
function localOptions(
  overrides: Partial<ProfileImageLoadingOptions> = {},
): ProfileImageLoadingOptions {
  return {
    downloadTimeoutMs: 1_000,
    maximumBytes: 1_024,
    fetchImage: () => {
      throw new Error('A local image source must not perform a download.');
    },
    ...overrides,
  };
}

/**
 * Builds loading options whose fetch returns one prepared response.
 *
 * Responses are real `Response` objects rather than hand-written stubs, so
 * header parsing and body reading behave exactly as they do in production.
 */
function remoteOptions(
  response: Response | (() => Promise<Response>),
  overrides: Partial<ProfileImageLoadingOptions> = {},
): ProfileImageLoadingOptions {
  return {
    downloadTimeoutMs: 1_000,
    maximumBytes: 1_024,
    fetchImage: typeof response === 'function'
      ? async () => response()
      : async () => response,
    ...overrides,
  };
}

/** Runs one case inside a temporary directory that is always removed after. */
async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'profile-image-loader-'));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('loads in-memory bytes with the supplied MIME type', async () => {
  const loaded = await loadProfileImage(
    { kind: 'bytes', data: IMAGE_BYTES, mimeType: 'image/png' },
    localOptions(),
  );

  assert.equal(loaded.mimeType, 'image/png');
  assert.deepEqual(loaded.data, IMAGE_BYTES);
});

test('rejects an empty byte source', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'bytes', data: new Uint8Array(), mimeType: 'image/png' },
        localOptions(),
      ),
    /image is empty/,
  );
});

test('rejects a byte source above the configured maximum', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'bytes', data: new Uint8Array(2_048), mimeType: 'image/png' },
        localOptions({ maximumBytes: 1_024 }),
      ),
    /2048 bytes; the configured limit is 1024 bytes/,
  );
});

test('infers the MIME type of a local file from its extension', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'photo.JPG');
    await writeFile(path, IMAGE_BYTES);

    const loaded = await loadProfileImage(
      { kind: 'file', path },
      localOptions(),
    );

    // The extension lookup is case-insensitive.
    assert.equal(loaded.mimeType, 'image/jpeg');
    assert.deepEqual(loaded.data, IMAGE_BYTES);
  });
});

test('prefers an explicit MIME type over the local file extension', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'photo.jpg');
    await writeFile(path, IMAGE_BYTES);

    const loaded = await loadProfileImage(
      { kind: 'file', path, mimeType: 'image/png' },
      localOptions(),
    );

    assert.equal(loaded.mimeType, 'image/png');
  });
});

test('rejects a local file whose type cannot be determined', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'photo.bmp');
    await writeFile(path, IMAGE_BYTES);

    await assert.rejects(
      () => loadProfileImage({ kind: 'file', path }, localOptions()),
      /Supply mimeType explicitly/,
    );
  });
});

test('rejects an empty local file', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'photo.png');
    await writeFile(path, new Uint8Array());

    await assert.rejects(
      () => loadProfileImage({ kind: 'file', path }, localOptions()),
      /image is empty/,
    );
  });
});

test('downloads a remote image with a supported Content-Type', async () => {
  const loaded = await loadProfileImage(
    { kind: 'url', url: 'https://images.invalid/photo.png' },
    remoteOptions(
      new Response(IMAGE_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ),
  );

  assert.equal(loaded.mimeType, 'image/png');
  assert.deepEqual(loaded.data, IMAGE_BYTES);
});

test('ignores Content-Type parameters and casing', async () => {
  const loaded = await loadProfileImage(
    { kind: 'url', url: 'https://images.invalid/photo.jpg' },
    remoteOptions(
      new Response(IMAGE_BYTES, {
        status: 200,
        headers: { 'content-type': 'IMAGE/JPEG; charset=binary' },
      }),
    ),
  );

  assert.equal(loaded.mimeType, 'image/jpeg');
});

test('sends the download request to the requested URL', async () => {
  const seen: string[] = [];

  await loadProfileImage(
    { kind: 'url', url: 'https://images.invalid/photo.png' },
    {
      downloadTimeoutMs: 1_000,
      maximumBytes: 1_024,
      fetchImage: async (input) => {
        seen.push(String(input));
        return new Response(IMAGE_BYTES, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      },
    },
  );

  assert.deepEqual(seen, ['https://images.invalid/photo.png']);
});

test('rejects a non-HTTP URL before attempting a download', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'ftp://images.invalid/photo.png' },
        localOptions(),
      ),
    /must use HTTP or HTTPS/,
  );
});

test('rejects an unsuccessful download status', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/missing.png' },
        remoteOptions(
          new Response('', { status: 404, statusText: 'Not Found' }),
        ),
      ),
    /Could not download the profile image \(404 Not Found\)/,
  );
});

test('rejects a missing or unsupported remote Content-Type', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/photo.png' },
        remoteOptions(new Response(IMAGE_BYTES, { status: 200 })),
      ),
    /unsupported or missing image Content-Type/,
  );

  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/photo.svg' },
        remoteOptions(
          new Response(IMAGE_BYTES, {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
          }),
        ),
      ),
    /unsupported or missing image Content-Type/,
  );
});

test('rejects a declared Content-Length above the limit before reading', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/large.png' },
        remoteOptions(
          new Response(IMAGE_BYTES, {
            status: 200,
            headers: {
              'content-type': 'image/png',
              'content-length': '99999',
            },
          }),
        ),
      ),
    /exceeds the configured 1024-byte limit/,
  );
});

test('rejects an oversized body when Content-Length is absent', async () => {
  // Content-Length is optional on a chunked response, so the byte check after
  // reading is the only thing standing between a huge image and the model.
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/large.png' },
        remoteOptions(
          new Response(new Uint8Array(2_048), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
      ),
    /2048 bytes; the configured limit is 1024 bytes/,
  );
});

test('rejects an empty remote body', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/empty.png' },
        remoteOptions(
          new Response(new Uint8Array(), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
      ),
    /image is empty/,
  );
});

test('propagates an aborted or timed-out download', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        { kind: 'url', url: 'https://images.invalid/slow.png' },
        remoteOptions(() => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }),
      ),
    (error: unknown) => error instanceof DOMException
      && error.name === 'AbortError',
  );
});
