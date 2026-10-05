/**
 * A date with only the precision LinkedIn provides.
 *
 * `year` may be absent when only text is available.
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
  /** What the person wrote about this role. */
  description?: string;
  /** Contract kind as LinkedIn labels it, such as full-time or freelance. */
  employmentType?: string;
  /** On-site, hybrid or remote, as LinkedIn labels it. */
  workplaceType?: string;

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
 * The minimal application-facing representation of one LinkedIn profile.
 *
 * Current employment is the experience with no end date.
 */
export interface Profile {
  /** Application-owned UUID or ordinary random database ID. */
  id: string;

  /** Current canonical LinkedIn profile URL. */
  linkedinUrl: string;

  firstName?: string;
  lastName?: string;

  headline?: string;
  /** The profile's own About section. */
  about?: string;
  /** Signed LinkedIn photo URL from the export; it expires some weeks later. */
  photo?: string;
  openToWork?: boolean;

  location?: ProfileLocation;

  experience: ProfileExperience[];
  education: ProfileEducation[];

  /**
   * The untouched source row for this profile. Columns the model omits stay
   * available here.
   */
  raw: unknown;
}
