/**
 * The small, application-friendly profile created from one Linked Helper row.
 * Optional properties use `?` because Linked Helper may leave those cells empty.
 */
export interface ImportedProfile {
  // LinkedIn's public profile slug, used as the current deduplication key.
  public_id: string;
  profileUrl: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  avatarUrl?: string;
  location?: string;

  // Preserve every original CSV value in case we need an unmodeled field later.
  raw: Record<string, string>;
}

/** Converts one raw Linked Helper CSV row into an ImportedProfile. */
export function toImportedProfile(
  row: Record<string, string>,
): ImportedProfile {
  // trim() removes accidental whitespace around values from the CSV.
  const publicId = row['public_id']?.trim();
  const firstName = row['first_name']?.trim();
  const lastName = row['last_name']?.trim();

  const profile: ImportedProfile = {
    public_id: publicId ?? '',
    profileUrl: row['profile_url']?.trim() ?? '',

    // Prefer Linked Helper's full_name, then build it from first and last name.
    fullName:
      row['full_name']?.trim() ||
      [firstName, lastName].filter(Boolean).join(' '),
    raw: row,
  };

  // Add optional fields only when a real value exists. This avoids storing empty strings.
  if (firstName) profile.firstName = firstName;
  if (lastName) profile.lastName = lastName;

  const headline = row['headline']?.trim();
  const avatarUrl = row['avatar']?.trim();
  const location = row['location_name']?.trim();

  if (headline) profile.headline = headline;
  if (avatarUrl) profile.avatarUrl = avatarUrl;
  if (location) profile.location = location;

  return profile;
}
