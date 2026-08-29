import { mkdir, writeFile } from "node:fs/promises";

/** Root folder that holds all runtime data written to disk. */
const DATA_STORAGE_DIR = "src/dataStorage";

/** Get the paths for the processing directory */
export function processingPaths(id: string)
{
    const dir = `${DATA_STORAGE_DIR}/processing/${id}`;
    return { dir, original: `${dir}/original.csv` };
}

/** Save the original CSV file to the processing directory */
export async function saveOriginalCsv(id: string, bytes: Buffer)
{
    const paths = processingPaths(id);

    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.original, bytes);

    return { processingId: id, originalPath: paths.original, dir: paths.dir };
}