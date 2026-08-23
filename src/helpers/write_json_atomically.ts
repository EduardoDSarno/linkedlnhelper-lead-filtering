import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes formatted JSON through a temporary file and atomically replaces the
 * destination, preventing readers from observing a partially written artifact.
 *
 * @param path - Destination path for the completed JSON document.
 * @param value - Serializable value to persist.
 * @throws When directory creation, serialization, writing, or renaming fails.
 */
export async function writeJsonAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporaryPath, path);
}
