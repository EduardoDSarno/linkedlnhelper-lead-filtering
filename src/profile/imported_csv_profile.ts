/** The untouched Linked Helper values from one CSV row. */
export type RawLinkedHelperCsvRow = Readonly<Record<string, string>>;

/** A small summary of mutual-connection data available in Linked Helper. */
export interface MutualConnectionSummary {
  count: number;
  names: string[];
}

/**
 * The current employment observed by Linked Helper.
 *
 * This is only a fallback before provider enrichment. Apify remains the source
 * of truth for the normalized employment history because Linked Helper only
 * populated these fields for a small part of the inspected export.
 */
export interface ImportedCurrentEmployment {
  companyName: string;
  position?: string;
  observedAt?: string;
}

/**
 * The application-friendly subset of one Linked Helper CSV row.
 *
 * Provider-specific duplicates and unused columns stay in the raw row instead
 * of becoming permanent application fields.
 */
export interface ImportedCsvProfileSummary {
  // Identity
  publicId: string;
  profileUrl: string;
  linkedHelperId: string;
  memberId?: string;
  hashId?: string;

  // Presentation
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  avatarUrl?: string;
  location?: string;

  // Profile flags
  openToWork: boolean;
  hiring: boolean;
  premium: boolean;
  influencer: boolean;

  // Linked Helper/network context
  memberDistance?: string;
  mutualConnections?: MutualConnectionSummary;
  addedToTargetAt?: string;

  observedCurrentEmployment?: ImportedCurrentEmployment;
}

/**
 * One imported profile combines the typed summary used by the application with
 * the complete source row retained for future mappings and auditability.
 */
export interface ImportedCsvProfile {
  summary: ImportedCsvProfileSummary;
  raw: RawLinkedHelperCsvRow;
}

/** Trims one optional CSV value and treats blank text as absent. */
function trimmedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Interprets only the exporter literal used for enabled boolean fields. */
function csvBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/** Parses a non-negative integer without accepting partial numeric text. */
function csvNonNegativeInteger(value: string | undefined): number | undefined {
  const trimmed = trimmedValue(value);

  if (!trimmed) return undefined;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Converts one raw Linked Helper CSV row into a normalized imported profile. */
export function toImportedCsvProfile(
  row: Record<string, string>,
): ImportedCsvProfile {
  const publicId = trimmedValue(row['public_id']) ?? '';
  const firstName = trimmedValue(row['first_name']);
  const lastName = trimmedValue(row['last_name']);
  const currentCompanyName = trimmedValue(row['current_company']);
  const currentPosition = trimmedValue(row['current_company_position']);
  const currentEmploymentObservedAt = trimmedValue(
    row['current_company_actual_at'],
  );

  const summary: ImportedCsvProfileSummary = {
    publicId,
    profileUrl: trimmedValue(row['profile_url']) ?? '',
    linkedHelperId: trimmedValue(row['lh_id']) ?? '',
    fullName:
      trimmedValue(row['full_name']) ??
      [firstName, lastName].filter(Boolean).join(' '),
    openToWork: csvBoolean(row['badges_job_seeker']),
    hiring: csvBoolean(row['badges_hiring']),
    premium: csvBoolean(row['badges_premium']),
    influencer: csvBoolean(row['badges_influencer']),
  };

  const memberId = trimmedValue(row['member_id']);
  const hashId = trimmedValue(row['hash_id']);
  const headline = trimmedValue(row['headline']);
  const avatarUrl = trimmedValue(row['avatar']);
  const location = trimmedValue(row['location_name']);
  const memberDistance = trimmedValue(row['member_distance']);
  const addedToTargetAt =
    trimmedValue(row['add_to_target_date_iso']) ??
    trimmedValue(row['add_to_target_date']);

  if (memberId) summary.memberId = memberId;
  if (hashId) summary.hashId = hashId;
  if (firstName) summary.firstName = firstName;
  if (lastName) summary.lastName = lastName;
  if (headline) summary.headline = headline;
  if (avatarUrl) summary.avatarUrl = avatarUrl;
  if (location) summary.location = location;
  if (memberDistance) summary.memberDistance = memberDistance;
  if (addedToTargetAt) summary.addedToTargetAt = addedToTargetAt;

  const mutualCount = csvNonNegativeInteger(row['mutual_count']);
  const mutualNames = [
    trimmedValue(row['mutual_first_fullname']),
    trimmedValue(row['mutual_second_fullname']),
  ].filter((name): name is string => name !== undefined);

  if (mutualCount !== undefined || mutualNames.length > 0) {
    summary.mutualConnections = {
      count: mutualCount ?? mutualNames.length,
      names: [...new Set(mutualNames)],
    };
  }

  if (currentCompanyName) {
    summary.observedCurrentEmployment = {
      companyName: currentCompanyName,
      ...(currentPosition ? { position: currentPosition } : {}),
      ...(currentEmploymentObservedAt
        ? { observedAt: currentEmploymentObservedAt }
        : {}),
    };
  }

  return {
    summary,
    raw: row,
  };
}
