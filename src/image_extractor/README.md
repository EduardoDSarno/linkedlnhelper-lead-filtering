# Image Extractor

The `image_extractor` module analyzes profile photos with Gemini 3.7 Flash and
returns a small, structured description of visible image composition and
technical quality.

It supports one image at a time or a collection processed with bounded
concurrency. The module does not modify the normalized profile and does not
write results to disk. Its caller decides where and how to store the returned
assessment.

## What it returns

Each successful extraction describes:

- whether a face is visible and how many faces are present;
- whether the face is clear, partial, or unclear;
- overall image quality, blur, and lighting;
- photo type, such as professional portrait, selfie, or group photo;
- framing, such as headshot, upper body, or full body;
- background and attire categories;
- whether the result is uncertain or requires manual review;
- short, neutral observations;
- Gemini model, media resolution, and token usage.
- Age bracket (with confidende level)

The extractor intentionally does not infer age, ethnicity, health, body size,
attractiveness, wealth, personality, professional competence, employability,
or candidate fit.

## Module structure

```text
image_extractor/
├── index.ts                         Public exports
├── profile_image_extractor.ts       Single-image and batch orchestration
├── profile_image_loader.ts          URL, file, and byte loading
├── gemini_profile_image_client.ts   Google Gen AI SDK communication
├── profile_image_assessment.ts      Runtime response validation
└── profile_image_types.ts           Types and Gemini JSON Schema
```

The processing flow is:

```text
ProfileImageSource
       ↓
loadProfileImage
       ↓
recognizeProfileImageWithGemini
       ↓
parseProfileImageAssessment
       ↓
ProfileImageExtractionResult
```

## Configuration

The module uses Google's official `@google/genai` SDK. It expects the Gemini
API key to be available server-side:

```env
GEMINI_API_KEY=your-key
```

The application entry point already imports `dotenv/config`. A standalone
script that imports the extractor directly should load its environment first:

```ts
import 'dotenv/config';
```

Do not expose `GEMINI_API_KEY` in browser/client-side code.

## Public API

All supported functions and types are exported from `index.ts`.

### Extract one image

`extractProfileImage` accepts a remote URL, local file, or byte array.

#### Remote URL

```ts
import { extractProfileImage } from './image_extractor/index.js';

const result = await extractProfileImage({
  kind: 'url',
  url: 'https://example.com/profile-photo.jpg',
});
```

Only HTTP and HTTPS URLs are accepted. The response must provide a supported
image `Content-Type`.

#### Local file

```ts
const result = await extractProfileImage({
  kind: 'file',
  path: '/absolute/path/profile-photo.jpg',
});
```

The MIME type is inferred from the filename extension. It can be supplied
explicitly when the extension is missing or ambiguous:

```ts
const result = await extractProfileImage({
  kind: 'file',
  path: '/absolute/path/profile-photo',
  mimeType: 'image/jpeg',
});
```

#### Existing bytes

```ts
const result = await extractProfileImage({
  kind: 'bytes',
  data: imageBytes,
  mimeType: 'image/png',
});
```

### Extract a normalized profile's photo

`extractProfilePhoto` reads the existing `photo` field from the minimal
normalized profile:

```ts
import { extractProfilePhoto } from './image_extractor/index.js';

const result = await extractProfilePhoto(profile);
```

It throws a clear error when the profile has no photo URL.

### Extract multiple images

`extractProfileImages` processes jobs concurrently while preserving input
order:

```ts
import { extractProfileImages } from './image_extractor/index.js';

const results = await extractProfileImages(
  profiles
    .filter((profile) => profile.photo)
    .map((profile) => ({
      id: profile.id,
      source: {
        kind: 'url' as const,
        url: profile.photo!,
      },
    })),
  {
    concurrency: 25,
    resolution: 'medium',
  },
);
```

One failed job does not cancel the remaining jobs. Every returned item is a
discriminated union:

```ts
type ProfileImageJobResult =
  | {
      id: string;
      status: 'fulfilled';
      result: ProfileImageExtractionResult;
    }
  | {
      id: string;
      status: 'rejected';
      error: string;
    };
```

## Extraction options

All options are optional:

| Option | Default | Purpose |
| --- | ---: | --- |
| `model` | `gemini-3.7-flash` | Gemini model identifier |
| `resolution` | `medium` | Image tokenization resolution: `low`, `medium`, or `high` |
| `requestTimeoutMs` | `30000` | Maximum time for one Gemini request |
| `imageDownloadTimeoutMs` | `15000` | Maximum time for a remote image download |
| `maxImageBytes` | `10485760` | Maximum accepted image size, 10 MiB |
| `maxRetries` | `3` | Retries after the initial Gemini request |
| `concurrency` | `25` | Batch workers; accepted only by `extractProfileImages` |

Batch concurrency is capped at 50 to avoid launching an unbounded number of
simultaneous image downloads and Gemini calls.

Gemini retries use exponential backoff for HTTP `408`, `429`, and common `5xx`
responses. Retry behavior is delegated to the Google Gen AI SDK.

## Supported image formats

- JPEG
- PNG
- WebP
- HEIC
- HEIF
- GIF
- AVIF

Inline image data is limited to 10 MiB by this module, below Gemini's overall
request-size limit.

## Result shape

```ts
interface ProfileImageExtractionResult {
  assessment: {
    hasFace: boolean;
    faceCount: number;
    faceVisibility: 'clear' | 'partial' | 'unclear' | 'not_applicable';
    imageQuality: 'good' | 'usable' | 'poor';
    isBlurry: boolean;
    isPoorlyLit: boolean;
    photoType:
      | 'professional_portrait'
      | 'selfie'
      | 'mirror_selfie'
      | 'group_photo'
      | 'other';
    framing: 'headshot' | 'upper_body' | 'full_body' | 'unclear';
    background:
      | 'plain'
      | 'workplace'
      | 'outdoor'
      | 'domestic'
      | 'other'
      | 'unclear';
    attire: 'formal' | 'business_casual' | 'casual' | 'unclear';
    certainty: 'certain' | 'uncertain' | 'unassessable';
    reviewRequired: boolean;
    observations: string[];
  };
  model: string;
  resolution: 'low' | 'medium' | 'high';
  usage?: {
    promptTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    totalTokens?: number;
  };
}
```

The JSON Schema sent to Gemini constrains its response, and
`profile_image_assessment.ts` validates the parsed data again at runtime before
returning it to the application.

## Errors

Single-image functions throw errors for conditions such as:

- missing `GEMINI_API_KEY`;
- missing profile photo URL;
- unsupported URL protocol or MIME type;
- empty or oversized image;
- image download failure or timeout;
- Gemini rejection, timeout, or exhausted retries;
- malformed or schema-incompatible Gemini output.

The batch function converts these errors into rejected result entries so that
other jobs can continue.

## Storage

The extractor only returns data. To preserve assessments, serialize the result
in the calling application:

```ts
import { writeFile } from 'node:fs/promises';

await writeFile(
  'output/profile-image-assessments.json',
  JSON.stringify(results, null, 2),
  'utf8',
);
```

The existing `output/profile-image-assessments.json` file is an example from a
20-profile run; it is not automatically rewritten whenever the extractor is
called.
