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

/** The backend's acknowledgement that a review run was accepted. */
export interface StartReviewResult {
    processingId: string;
}

/**
 * Starts the evaluation pipeline for an imported CSV.
 *
 * The backend runs it in the background and returns immediately, so the caller
 * then polls the run's status. The criteria object comes straight from the
 * criteria form's `toEvaluationCriteria`.
 */
export async function startReview(
    processingId: string,
    criteria: unknown,
): Promise<StartReviewResult> {
    const response = await fetch('/run_filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processingId, criteria }),
    });

    if (!response.ok) {
        const message = await response
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => undefined);
        throw new Error(message ?? `Request failed: ${response.status}`);
    }

    return (await response.json()) as StartReviewResult;
}