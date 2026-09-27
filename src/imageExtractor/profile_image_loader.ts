/** Image types the model request accepts, matched against Content-Type. */
const PROFILE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
] as const;

type ProfileImageMimeType = (typeof PROFILE_IMAGE_MIME_TYPES)[number];

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

/**
 * Downloads one profile photo and returns its bytes with a supported type.
 *
 * Size is checked after reading, not only from a declared `Content-Length`:
 * that header is optional on a chunked response, so the post-read check is the
 * only thing that bounds an undeclared download.
 *
 * @throws When the URL is not HTTP(S), the download fails or times out, or the
 * image is empty, too large, or of an unsupported type.
 */
export async function loadProfileImage(
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

/** Extracts a normalized supported MIME type from an HTTP Content-Type header. */
function parseContentType(value: string | null): ProfileImageMimeType | undefined {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return PROFILE_IMAGE_MIME_TYPES.find((supported) => supported === mimeType);
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
