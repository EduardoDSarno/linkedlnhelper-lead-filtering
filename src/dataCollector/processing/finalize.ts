import { readFile } from 'node:fs/promises';

import { MANUAL_DECISION } from '../../database/index.js';
import type {
  ManualOverride,
  StoredEvaluationRun,
} from '../../database/index.js';
import type { FullProfile } from '../../profile/index.js';
import { readRawRecords } from '../csv/csvdata.js';
import { collectApprovedPublicIds, writeApprovedCsv } from './approved_csv.js';
import { writeEvaluationReport } from './evaluation_report.js';
import type { ProcessingPaths } from './processing.js';

/** The approved set after human overrides, plus ids that matched no profile. */
export interface OverrideApplication {
  approvedPublicIds: Set<string>;
  unknownPublicIds: string[];
}

/**
 * Applies human decisions on top of the automatic approvals.
 *
 * An approved override adds the profile, a rejected one removes it, and every
 * profile left unmentioned keeps its automatic decision. Ids that never
 * appeared in the evaluation are returned so the caller can reject the request
 * instead of silently ignoring a typo.
 */
export function applyOverrides(
  evaluationRun: StoredEvaluationRun,
  overrides: readonly ManualOverride[],
): OverrideApplication {
  const approvedPublicIds = collectApprovedPublicIds(evaluationRun);

  const knownPublicIds = new Set(
    evaluationRun.evaluation.broadFilter.evaluations
      .map((evaluation) => evaluation.linkedHelperPublicId)
      .filter((publicId): publicId is string => Boolean(publicId)),
  );

  const unknownPublicIds: string[] = [];

  for (const override of overrides) {
    if (!knownPublicIds.has(override.publicId)) {
      unknownPublicIds.push(override.publicId);
      continue;
    }
    if (override.decision === MANUAL_DECISION.approved) {
      approvedPublicIds.add(override.publicId);
    } else {
      approvedPublicIds.delete(override.publicId);
    }
  }

  return { approvedPublicIds, unknownPublicIds };
}

/**
 * Rebuilds both output artifacts from the retained original after human review.
 *
 * The approved CSV is rebuilt from the original's exact bytes so the vendor
 * checksums stay valid, and the report gains the final decision and the
 * reviewer's optional reason for every overridden profile.
 */
export async function finalizeRun(
  paths: ProcessingPaths,
  evaluationRun: StoredEvaluationRun,
  profiles: readonly FullProfile[],
  overrides: readonly ManualOverride[],
): Promise<{ finalApprovedCount: number }> {
  const { approvedPublicIds } = applyOverrides(evaluationRun, overrides);

  const originalBytes = await readFile(paths.original);
  const raw = readRawRecords(originalBytes);

  await writeApprovedCsv(raw, approvedPublicIds, paths.approved);
  await writeEvaluationReport(profiles, evaluationRun, paths.report, overrides);

  return { finalApprovedCount: approvedPublicIds.size };
}
