import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes bytes or text through a temporary file and atomically replaces the
 * destination, so a reader never observes a half-written artifact and a crash
 * mid-write leaves the previous file intact.
 *
 * @param path - Destination path for the completed file.
 * @param data - Exact bytes, or text, to persist.
 * @throws When directory creation, writing, or renaming fails.
 */
export async function writeFileAtomically(
  path: string,
  data: Buffer | string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, path);
}
