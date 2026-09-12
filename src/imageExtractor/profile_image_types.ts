import type { ModelClient } from '../models/index.js';

export type { ModelClient, ModelTokenUsage } from '../models/index.js';

export const PROFILE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
] as const;

export type ProfileImageMimeType =
  (typeof PROFILE_IMAGE_MIME_TYPES)[number];

export type ProfileImageSource =
  | {
      kind: 'url';
      url: string;
    }
  | {
      kind: 'file';
      path: string;
      mimeType?: ProfileImageMimeType;
    }
  | {
      kind: 'bytes';
      data: Uint8Array;
      mimeType: ProfileImageMimeType;
    };

export type ProfileImageResolution = 'low' | 'medium' | 'high';

export interface ProfileImageExtractionOptions {
  model?: string;
  resolution?: ProfileImageResolution;
  requestTimeoutMs?: number;
  imageDownloadTimeoutMs?: number;
  maxImageBytes?: number;
  maxRetries?: number;

  /** Optional model call used by deterministic tests instead of a provider client. */
  generateContent?: ModelClient;
}
