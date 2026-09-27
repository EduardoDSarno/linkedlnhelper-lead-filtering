import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProfileImage } from '../profile_image_loader.js';
import type { ProfileImageLoadingOptions } from '../profile_image_loader.js';

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

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

test('downloads a remote image with a supported Content-Type', async () => {
  const loaded = await loadProfileImage(
    'https://images.invalid/photo.png',
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
    'https://images.invalid/photo.jpg',
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
    'https://images.invalid/photo.png',
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
      loadProfileImage('ftp://images.invalid/photo.png', {
        downloadTimeoutMs: 1_000,
        maximumBytes: 1_024,
        fetchImage: () => {
          throw new Error('A rejected URL must not perform a download.');
        },
      }),
    /must use HTTP or HTTPS/,
  );
});

test('rejects an unsuccessful download status', async () => {
  await assert.rejects(
    () =>
      loadProfileImage(
        'https://images.invalid/missing.png',
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
        'https://images.invalid/photo.png',
        remoteOptions(new Response(IMAGE_BYTES, { status: 200 })),
      ),
    /unsupported or missing image Content-Type/,
  );

  await assert.rejects(
    () =>
      loadProfileImage(
        'https://images.invalid/photo.svg',
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
        'https://images.invalid/large.png',
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
        'https://images.invalid/large.png',
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
        'https://images.invalid/empty.png',
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
        'https://images.invalid/slow.png',
        remoteOptions(() => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }),
      ),
    (error: unknown) => error instanceof DOMException
      && error.name === 'AbortError',
  );
});
