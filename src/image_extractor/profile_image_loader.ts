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

function isProfileImageMimeType(value: string): value is ProfileImageMimeType {
  return PROFILE_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

function parseContentType(value: string | null): ProfileImageMimeType | undefined {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mimeType && isProfileImageMimeType(mimeType) ? mimeType : undefined;
}

function mimeTypeFromPath(path: string): ProfileImageMimeType | undefined {
  return MIME_TYPE_BY_EXTENSION[extname(path).toLowerCase()];
}

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

async function loadRemoteImage(
  urlValue: string,
  options: ProfileImageLoadingOptions,
): Promise<LoadedProfileImage> {
  const url = new URL(urlValue);

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Profile image URLs must use HTTP or HTTPS.');
  }

  const response = await fetch(url, {
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
