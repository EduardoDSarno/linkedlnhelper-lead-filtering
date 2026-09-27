# Profile photos

Downloads a profile photo so it can be sent to the model inside the
evaluation request. It does not assess the photo itself: the model sees the
image directly, which costs one request instead of two and keeps detail a
written summary would lose.

## Use

```ts
import { loadProfileImage, PROFILE_IMAGE_DOWNLOAD } from './photos/index.js';

const photo = await loadProfileImage(profile.photoUrl, {
  downloadTimeoutMs: PROFILE_IMAGE_DOWNLOAD.timeoutMs,
  maximumBytes: PROFILE_IMAGE_DOWNLOAD.maximumBytes,
});
// photo.data: bytes, photo.mimeType: e.g. 'image/jpeg'
```

## Failure is expected

It throws when the image is empty, larger than the configured limit, of an
unsupported type, or cannot be downloaded in time. Callers treat that as a
missing photo, not a failed profile: LinkedIn signs photo URLs with an expiry,
so some collected URLs are dead by the time a profile is evaluated. See
`evaluate.ts`, which evaluates such a profile on its text alone.

## Files

- `profile_image_loader.ts`: downloads a photo and checks its type and size.
- `config.ts`: the download timeout and size limit.
