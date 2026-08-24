import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { PROFILE_IMAGE_MIME_TYPES } from './profile_image_types.js';
import type {
  ProfileImageMimeType,
  ProfileImageSource,
} from './profile_image_types.js';

export interface LoadedProfileImage {
  data: Uint8Array;
  mimeType: ProfileImageMimeType;
}

export interface ProfileImageLoadingOptions {
  downloadTimeoutMs: number;
  maximumBytes: number;

  /**
   * Performs the image download. Production omits this and gets global fetch;
   * tests supply a stand-in so no public image URL is ever contacted.
   */
  fetchImage?: typeof fetch;
}

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, ProfileImageMimeType>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Returns whether a provider MIME value is supported by Gemini extraction. */
function isProfileImageMimeType(value: string): value is ProfileImageMimeType {
  return PROFILE_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

/** Extracts a normalized supported MIME type from an HTTP Content-Type header. */
function parseContentType(value: string | null): ProfileImageMimeType | undefined {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mimeType && isProfileImageMimeType(mimeType) ? mimeType : undefined;
}

/** Infers a supported image MIME type from a local filename extension. */
function mimeTypeFromPath(path: string): ProfileImageMimeType | undefined {
  return MIME_TYPE_BY_EXTENSION[extname(path).toLowerCase()];
}

/** Rejects image data that is empty or exceeds the caller's accepted size. */
function validateImageSize(data: Uint8Array, maximumBytes: number): void {
  if (data.byteLength === 0) {
    throw new Error('The profile image is empty.');
  }

  if (data.byteLength > maximumBytes) {
    throw new Error(
      `The profile image is ${data.byteLength} bytes; the configured limit is ${maximumBytes} bytes.`,
    );
  }
}

/** Downloads and validates one remote profile image. */
async function loadRemoteImage(
  urlValue: string,
  options: ProfileImageLoadingOptions,
): Promise<LoadedProfileImage> {
  const url = new URL(urlValue);

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Profile image URLs must use HTTP or HTTPS.');
  }

  const response = await (options.fetchImage ?? fetch)(url, {
    headers: { Accept: 'image/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.downloadTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `Could not download the profile image (${response.status} ${response.statusText}).`,
    );
  }

  const mimeType = parseContentType(response.headers.get('content-type'));
  if (!mimeType) {
    throw new Error(
      'The profile image URL returned an unsupported or missing image Content-Type.',
    );
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > options.maximumBytes) {
    throw new Error(
      `The remote profile image exceeds the configured ${options.maximumBytes}-byte limit.`,
    );
  }

  const data = new Uint8Array(await response.arrayBuffer());
  validateImageSize(data, options.maximumBytes);

  return { data, mimeType };
}

/**
 * Resolves any profile image source into bytes with a supported MIME type.
 *
 * Size is validated after reading in every case, not only from a declared
 * `Content-Length`: that header is optional on a chunked response, so the
 * post-read check is the only thing that bounds an undeclared download.
 *
 * @param source - In-memory bytes, a local file, or an HTTP(S) URL.
 * @param options - Download timeout, size limit, and an optional fetch.
 * @returns The image bytes and the MIME type to send to the model.
 * @throws When the image is empty, too large, unreadable, or of an
 * unsupported type.
 */
export async function loadProfileImage(
  source: ProfileImageSource,
  options: ProfileImageLoadingOptions,
): Promise<LoadedProfileImage> {
  if (source.kind === 'url') {
    return loadRemoteImage(source.url, options);
  }

  if (source.kind === 'bytes') {
    validateImageSize(source.data, options.maximumBytes);
    return { data: source.data, mimeType: source.mimeType };
  }

  const data = new Uint8Array(await readFile(source.path));
  validateImageSize(data, options.maximumBytes);

  const mimeType = source.mimeType ?? mimeTypeFromPath(source.path);
  if (!mimeType) {
    throw new Error(
      'Could not determine the local profile image MIME type. Supply mimeType explicitly.',
    );
  }

  return { data, mimeType };
}
