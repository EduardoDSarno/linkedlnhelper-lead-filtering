/** Counts the backend reports after parsing the uploaded CSV. */
export interface ImportResult {
    processingId: string;
    totalRows: number;
    validProfiles: number;
    duplicatedProfiles: number;
    invalidProfiles: number;
}

/** Imports a CSV file into the backend. 
 * via the /import endpoint.
*/
export async function importCsv(file: File): Promise<ImportResult>
{
    const response = await fetch('/import', 
    {
        method: 'POST',
        headers: {
            'Content-Type': 'text/csv',
        },
        body: file
    });

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

    const data = (await response.json()) as ImportResult;
    return data;
}