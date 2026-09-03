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
    name: string,
): Promise<StartReviewResult> {
    const response = await fetch('/run_filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processingId, criteria, name }),
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

export type ProcessingStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired';

export interface RunStatus
{
    processingId: string;
    status: ProcessingStatus;
    evaluationRunId?: string;   // present once the run produced results
    error?: string;             // present only on 'failed'
    completedAt?: string;       // present once finished
}

/** Retrieves the status of a processing run, via the /run_filter/:processingId endpoint. */
export async function getStatus(processingId: string): Promise<RunStatus>
{
    const response = await fetch(`/run_filter/${processingId}`);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return (await response.json()) as RunStatus;
}

/** A model decision for one profile. */
export type ModelDecision = 'approved' | 'rejected' | 'manual_review';

/** A decision a human reviewer can assign. */
export type ManualDecision = 'approved' | 'rejected';

/** One human decision already recorded for a profile. */
export interface ManualOverride {
    publicId: string;
    decision: ManualDecision;
    reason?: string;
}

/** A model-estimated monthly compensation range, or a refusal to estimate. */
export type Compensation =
    | {
          status: 'estimated';
          currency: 'BRL';
          minimumMonthlyCompensation: number;
          maximumMonthlyCompensation: number;
          confidence: 'high' | 'medium' | 'low';
          basis: string[];
      }
    | { status: 'insufficient_evidence'; reasons: string[] };

/** How a compensation estimate compared with the campaign's desired range. */
export interface CompensationMatch {
    outcome: 'matched' | 'not_matched' | 'unknown';
    overlapRatio?: number;
    explanation: string;
}

/** A partially known month/year value from LinkedIn. */
export interface ProfileDate {
    year?: number;
    month?: number;
    text?: string;
}

/** One role in the profile's professional history. */
export interface ProfileExperience {
    position: string;
    companyName: string;
    location?: string;
    startDate?: ProfileDate;
    endDate?: ProfileDate;
    description?: string;
}

/** One item in the profile's education history. */
export interface ProfileEducation {
    schoolName: string;
    degree?: string;
    fieldOfStudy?: string;
    startDate?: ProfileDate;
    endDate?: ProfileDate;
}

/**
 * Extra profile information used only by the expanded review view.
 *
 * These fields are optional until the real results endpoint starts returning
 * them; mock mode defines the visual contract first.
 */
export interface ProfileDetails {
    about?: string;
    openToWork?: boolean;
    experience: ProfileExperience[];
    education: ProfileEducation[];
    photoSummary?: string;
}

/** Apparent-age shape returned by the real image-analysis pipeline. */
export interface ApparentAgeEstimate {
    bracket: string;
    confidence: 'high' | 'medium' | 'low' | 'unassessable';
}

/** A short, categorized signal shown as a colored chip in the review row. */
export type ProfileHighlightKind = 'strength' | 'warning' | 'info';
export interface ProfileHighlight {
    kind: ProfileHighlightKind;
    text: string;
}

/** Everything the review list knows about one evaluated profile. */
export interface ProfileResult {
    publicId: string;
    name: string;
    linkedinUrl: string;

    /** 'Failed' means the deterministic filter excluded it before the model. */
    broadDecision: string;
    broadDecisionMessage: string;

    headline?: string;
    position?: string;
    company?: string;
    location?: string;
    photo?: string;
    apparentAge?: string | ApparentAgeEstimate;
    details?: ProfileDetails;

    /** Absent when the profile never reached the model or its request failed. */
    modelDecision?: ModelDecision;
    matchPercent?: number;
    reasons?: string[];
    evidence?: string[];
    uncertainties?: string[];
    highlights?: ProfileHighlight[];
    compensation?: Compensation;
    compensationMatch?: CompensationMatch;

    override?: ManualOverride;
}

/** Evaluation results for one run. */
export interface RunResults {
    processingId: string;
    results: ProfileResult[];
}

/** Retrieves every evaluated profile for one run, via /run_filter/:processingId/results. */
export async function getResults(processingId: string): Promise<RunResults>
{
    const response = await fetch(`/run_filter/${processingId}/results`);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return (await response.json()) as RunResults;
}

/** Outcome of saving human decisions for one run. */
export interface DecisionsResult {
    processingId: string;
    finalApprovedCount: number;
    overridesApplied: number;
}

/**
 * Saves the reviewer's decisions, which rebuilds the approved CSV and report.
 *
 * Only the overrides are sent; profiles left untouched keep their automatic
 * decision, and re-submitting replaces the previous set entirely.
 */
export async function submitDecisions(
    processingId: string,
    overrides: ManualOverride[],
    name: string,
): Promise<DecisionsResult> {
    const response = await fetch(`/run_filter/${processingId}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides, name }),
    });

    if (!response.ok) {
        const message = await response
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => undefined);
        throw new Error(message ?? `Request failed: ${response.status}`);
    }

    return (await response.json()) as DecisionsResult;
}

/** Which output file a download refers to. */
export type ArtifactKind = 'approved' | 'report';

/**
 * Triggers a browser download of one artifact.
 *
 * The server sends the file with a Content-Disposition attachment header, so a
 * same-origin link click downloads it (with the server's filename) rather than
 * navigating the page.
 */
export function startDownload(processingId: string, artifact: ArtifactKind): void {
    const anchor = document.createElement('a');
    anchor.href = `/download/${processingId}/${artifact}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

/** Final per-profile decision totals for a concluded campaign. */
export interface DecisionCounts {
    approved: number;
    rejected: number;
    manual: number;
    failed: number;
}

/** One campaign row in the campaigns table. */
export interface CampaignSummary {
    processingId: string;
    name: string;
    status: ProcessingStatus;
    createdAt: string;
    updatedAt?: string;
    completedAt?: string;
    systemPrompt?: string;
    counts?: DecisionCounts;
}

/** Lists every campaign (processing run), newest first. */
export async function listRuns(): Promise<CampaignSummary[]> {
    const response = await fetch('/runs');
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    const body = (await response.json()) as { runs: CampaignSummary[] };
    return body.runs;
}

/** Renames one campaign. */
export async function renameRun(processingId: string, name: string): Promise<void> {
    const response = await fetch(`/runs/${processingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
}

/** Deletes one campaign and its files. */
export async function deleteRun(processingId: string): Promise<void> {
    const response = await fetch(`/runs/${processingId}`, { method: 'DELETE' });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
}


