/**
 * Anonymized Linked Helper CSV rows and files for deterministic tests.
 *
 * Linked Helper exports semicolon-delimited CSV with a UTF-8 BOM, so the file
 * builder reproduces both. Every value is invented; no real person, profile
 * URL, or avatar appears here.
 */

/** The Linked Helper columns the importer reads, in export order. */
export const LINKED_HELPER_COLUMNS = [
  'public_id',
  'profile_url',
  'lh_id',
  'member_id',
  'hash_id',
  'full_name',
  'first_name',
  'last_name',
  'headline',
  'avatar',
  'location_name',
  'badges_job_seeker',
  'badges_hiring',
  'badges_premium',
  'badges_influencer',
  'member_distance',
  'mutual_count',
  'mutual_first_fullname',
  'mutual_second_fullname',
  'add_to_target_date_iso',
  'add_to_target_date',
  'current_company',
  'current_company_position',
  'current_company_actual_at',
] as const;

/** Builds one fully populated row, overriding any columns given. */
export function linkedHelperRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    public_id: 'test-person-001',
    profile_url: 'https://www.linkedin.com/in/test-person-001',
    lh_id: 'lh-001',
    member_id: 'member-001',
    hash_id: 'hash-001',
    full_name: 'Avery Stone',
    first_name: 'Avery',
    last_name: 'Stone',
    headline: 'Operations Lead at Example Logistics',
    avatar: 'https://example.invalid/photos/test-person-001.jpg',
    location_name: 'Lisbon, Portugal',
    badges_job_seeker: 'true',
    badges_hiring: 'false',
    badges_premium: 'true',
    badges_influencer: 'false',
    member_distance: 'DISTANCE_2',
    mutual_count: '2',
    mutual_first_fullname: 'Blake Rivers',
    mutual_second_fullname: 'Casey Meadows',
    add_to_target_date_iso: '2026-01-15T10:00:00Z',
    add_to_target_date: '15/01/2026',
    current_company: 'Example Logistics',
    current_company_position: 'Operations Lead',
    current_company_actual_at: '2026-01-10',
    ...overrides,
  };
}

/** Builds a row with only the identity columns populated. */
export function sparseLinkedHelperRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const row: Record<string, string> = {};

  for (const column of LINKED_HELPER_COLUMNS) {
    row[column] = '';
  }

  return {
    ...row,
    public_id: 'test-person-002',
    profile_url: 'https://www.linkedin.com/in/test-person-002',
    lh_id: 'lh-002',
    ...overrides,
  };
}

/**
 * Serializes rows as a Linked Helper export.
 *
 * Values containing the delimiter are quoted, matching what the exporter does,
 * so the parser's delimiter handling is genuinely exercised.
 */
export function linkedHelperCsv(
  rows: readonly Record<string, string>[],
  options: { bom?: boolean } = {},
): string {
  const escape = (value: string): string =>
    value.includes(';') || value.includes('"') || value.includes('\n')
      ? `"${value.replace(/"/g, '""')}"`
      : value;

  const header = LINKED_HELPER_COLUMNS.join(';');
  const body = rows.map((row) =>
    LINKED_HELPER_COLUMNS.map((column) => escape(row[column] ?? '')).join(';'),
  );

  // Linked Helper writes a UTF-8 BOM ahead of the first header name.
  const prefix = options.bom === false ? '' : '﻿';
  return `${prefix}${[header, ...body].join('\n')}\n`;
}
