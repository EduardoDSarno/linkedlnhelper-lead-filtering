/**
 * A date with only the precision LinkedIn provides.
 *
 * `year` may be absent when the provider only returns text such as "Present".
 * `month`, when available, is normalized to a number from 1 through 12.
 */
export interface ProfileDate {
  year?: number;
  month?: number;
  text?: string;
}

/** The original LinkedIn location plus its useful parsed components. */
export interface ProfileLocation {
  /** Original human-readable LinkedIn location. */
  text: string;

  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
}

/** The employment information used during profile review. */
export interface ProfileExperience {
  position: string;
  companyName: string;
  /** Provider-reported location of this job, when available. */
  location?: string;

  startDate?: ProfileDate;
  endDate?: ProfileDate;
}

/** The education information used during profile review. */
export interface ProfileEducation {
  schoolName: string;
  degree?: string;
  fieldOfStudy?: string;

  startDate?: ProfileDate;
  endDate?: ProfileDate;
}

/**
 * The minimal application-facing representation of one Apify profile.
 *
 * `fullName` is derived from `firstName` and `lastName`. Current employment is
 * derived from the experience whose `endDate.text` is "Present".
 */
export interface Profile {
  /** Application-owned UUID or ordinary random database ID. */
  id: string;

  /** Current canonical LinkedIn profile URL. */
  linkedinUrl: string;

  firstName?: string;
  lastName?: string;

  headline?: string;
  photo?: string;
  openToWork?: boolean;

  location?: ProfileLocation;

  experience: ProfileExperience[];
  education: ProfileEducation[];

  /**
   * Complete untouched Apify object for this profile. Fields omitted from the
   * normalized model remain available here.
   */
  raw: unknown;
}
