import { mkdir, writeFile } from "node:fs/promises";

/** Root folder that holds all runtime data written to disk. */
const DATA_STORAGE_DIR = "src/dataStorage";

/** Every file path one processing run reads from or writes to on disk. */
export interface ProcessingPaths {
    dir: string;
    original: string;
    approved: string;
    report: string;
}

/** Resolves the fixed file layout for one processing run's directory. */
export function processingPaths(id: string): ProcessingPaths
{
    const dir = `${DATA_STORAGE_DIR}/processing/${id}`;
    return {
        dir,
        original: `${dir}/original.csv`,
        approved: `${dir}/approved-linked-helper.csv`,
        report: `${dir}/evaluation-report.csv`,
    };
}

/** Save the original CSV file to the processing directory */
export async function saveOriginalCsv(id: string, bytes: Buffer)
{
    const paths = processingPaths(id);

    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.original, bytes);

    return { processingId: id, originalPath: paths.original, dir: paths.dir };
}