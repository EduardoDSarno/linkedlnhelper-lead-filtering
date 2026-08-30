import { writeFileAtomically } from '../../helpers/index.js';
import { MODEL_EVALUATION_DECISION } from '../../evaluation/index.js';
import type { StoredEvaluationRun } from '../../database/index.js';
import type { RawCsvFile } from '../csv/csvdata.js';

/**
 * Collects the exact Linked Helper public IDs the model approved.
 *
 * A profile the broad filter excluded never reaches the model, so it is simply
 * absent here. Only approvals are retained; manual-review and rejected profiles
 * are deliberately left out of the approved CSV.
 */
export function collectApprovedPublicIds(
  run: StoredEvaluationRun,
): Set<string> {
  const approved = new Set<string>();

  for (const evaluation of run.evaluation.modelEvaluation.evaluations) {
    if (
      evaluation.decision === MODEL_EVALUATION_DECISION.approved &&
      evaluation.linkedHelperPublicId
    ) {
      approved.add(evaluation.linkedHelperPublicId);
    }
  }

  return approved;
}

/**
 * Rebuilds a Linked Helper CSV containing only the approved rows, copying the
 * original header and each approved row as its verbatim bytes so the vendor
 * checksums stay valid. Nothing is re-encoded.
 */
export async function writeApprovedCsv(
  raw: RawCsvFile,
  approvedPublicIds: Set<string>,
  outputPath: string,
): Promise<void> {
  const approvedRows = raw.records
    .filter((record) => approvedPublicIds.has(record.publicId))
    .map((record) => record.bytes);

  const csv = Buffer.concat([raw.header, ...approvedRows]);
  await writeFileAtomically(outputPath, csv);
}
