import { writeFileAtomically } from '../../helpers/index.js';
import type { StoredEvaluationRun } from '../../database/index.js';
import type { FullProfile } from '../../profile/index.js';

/** UTF-8 BOM so spreadsheets open accented names in the correct encoding. */
const UTF8_BOM = '﻿';

/** Separator between fields; the report is our own file, not a vendor CSV. */
const FIELD_DELIMITER = ',';

/** Row terminator spreadsheets expect. */
const ROW_TERMINATOR = '\r\n';

/** Joins the model's multi-value fields into one readable cell. */
const LIST_SEPARATOR = ' | ';

/** Column order of the explanatory report. */
const REPORT_COLUMNS = [
  'public_id',
  'name',
  'linkedin_url',
  'broad_decision',
  'model_decision',
  'match_percent',
  'reasons',
  'evidence',
  'uncertainties',
  'status',
] as const;

/** Human-facing status describing how far one profile progressed. */
const REPORT_STATUS = {
  filteredOut: 'filtered_out',
  evaluated: 'evaluated',
  modelError: 'model_error',
  modelIncomplete: 'model_incomplete',
} as const;

/** Quotes one field only when it contains a delimiter, quote, or line break. */
function quoteCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Renders one record as a delimited, escaped CSV line. */
function toCsvLine(values: readonly string[]): string {
  return values.map(quoteCsvField).join(FIELD_DELIMITER);
}

/** Builds a profile's display name from the parts the provider returned. */
function profileName(profile: FullProfile | undefined): string {
  if (!profile) return '';
  return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
}

/**
 * Builds the explanatory report as CSV text covering every evaluated profile.
 *
 * The broad-filter results are the spine because they include every profile,
 * even those excluded before the model stage. Model results, source profiles,
 * and model failures are joined by their Linked Helper public ID or profile ID.
 */
export function buildEvaluationReportCsv(
  profiles: readonly FullProfile[],
  run: StoredEvaluationRun,
): string {
  const { broadFilter, modelEvaluation } = run.evaluation;

  const profileByPublicId = new Map<string, FullProfile>();
  const publicIdByProfileId = new Map<string, string>();
  for (const profile of profiles) {
    if (profile.linkedHelperPublicId) {
      profileByPublicId.set(profile.linkedHelperPublicId, profile);
      publicIdByProfileId.set(profile.id, profile.linkedHelperPublicId);
    }
  }

  const modelByPublicId = new Map(
    modelEvaluation.evaluations
      .filter((evaluation) => evaluation.linkedHelperPublicId)
      .map((evaluation) => [evaluation.linkedHelperPublicId as string, evaluation]),
  );

  // Model failures are reported per profile ID; translate them to public IDs.
  const failureByPublicId = new Map<string, string>();
  for (const failure of modelEvaluation.failures) {
    for (const profileId of failure.profileIds) {
      const publicId = publicIdByProfileId.get(profileId);
      if (publicId) failureByPublicId.set(publicId, failure.error);
    }
  }

  const lines = [toCsvLine(REPORT_COLUMNS)];

  for (const broad of broadFilter.evaluations) {
    const publicId = broad.linkedHelperPublicId ?? '';
    const model = modelByPublicId.get(publicId);
    const failureError = failureByPublicId.get(publicId);

    let status: string;
    let reasons: string;

    if (broad.decision === 'Failed') {
      status = REPORT_STATUS.filteredOut;
      reasons = broad.decisionMessage;
    } else if (model) {
      status = REPORT_STATUS.evaluated;
      reasons = model.reasons.join(LIST_SEPARATOR);
    } else if (failureError) {
      status = REPORT_STATUS.modelError;
      reasons = failureError;
    } else {
      status = REPORT_STATUS.modelIncomplete;
      reasons = '';
    }

    lines.push(
      toCsvLine([
        publicId,
        profileName(profileByPublicId.get(publicId)),
        profileByPublicId.get(publicId)?.linkedinUrl ?? '',
        broad.decision,
        model?.decision ?? '',
        model ? String(model.matchPercent) : '',
        reasons,
        model?.evidence.join(LIST_SEPARATOR) ?? '',
        model?.uncertainties.join(LIST_SEPARATOR) ?? '',
        status,
      ]),
    );
  }

  return UTF8_BOM + lines.join(ROW_TERMINATOR) + ROW_TERMINATOR;
}

/** Writes the explanatory report atomically to the run's report path. */
export async function writeEvaluationReport(
  profiles: readonly FullProfile[],
  run: StoredEvaluationRun,
  outputPath: string,
): Promise<void> {
  await writeFileAtomically(outputPath, buildEvaluationReportCsv(profiles, run));
}
