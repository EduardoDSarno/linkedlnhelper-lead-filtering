export interface ImportedProfile {
  public_id: string;
  profileUrl: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  avatarUrl?: string;
  location?: string;
  raw: Record<string, string>;
}

export function toImportedProfile(
  row: Record<string, string>,
): ImportedProfile {
  const publicId = row['public_id']?.trim();
  const firstName = row['first_name']?.trim();
  const lastName = row['last_name']?.trim();

  const profile: ImportedProfile = {
    public_id: publicId ?? '',
    profileUrl: row['profile_url']?.trim() ?? '',
    fullName:
      row['full_name']?.trim() ||
      [firstName, lastName].filter(Boolean).join(' '),
    raw: row,
  };

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
