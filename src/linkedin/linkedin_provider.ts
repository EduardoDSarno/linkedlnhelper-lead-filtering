/**
 * The LinkedIn actions the funnel needs, independent of which vendor performs
 * them.
 *
 * Everything outside `linkedin/` depends on this interface and never on a
 * vendor SDK, so replacing the vendor, or moving to a new workspace with the
 * same vendor, changes one adapter instead of the pipeline.
 *
 * Every person is identified by `memberId`, LinkedIn's own member id. It is
 * issued by LinkedIn rather than by the vendor, so leads stored under it
 * survive a vendor or workspace change. The `accountId` passed to each call
 * is the vendor's handle for a connected client account, and is the one value
 * that has to be re-linked when the vendor workspace changes.
 */
export interface LinkedinProvider {
  /**
   * Creates a one-time link where a client logs into LinkedIn on the vendor's
   * page, so our server never sees the client's password.
   */
  createConnectLink(request: LinkedinConnectLinkRequest): Promise<string>;

  /**
   * Moves a connected account's traffic to a proxy in the given country, so
   * LinkedIn sees the account acting from where its owner actually is.
   */
  setAccountCountry(accountId: string, countryCode: string): Promise<void>;

  /** Runs a LinkedIn people search from a pasted search URL, one page at a time. */
  searchPeople(
    accountId: string,
    request: LinkedinSearchRequest,
  ): Promise<LinkedinSearchPage>;

  /**
   * Fetches one person's full profile without notifying them of the view.
   *
   * Returned as the vendor's own record: mapping it into the app's profile
   * model is the job of a profile source, as it is for Harvest's records.
   */
  getProfile(accountId: string, memberId: string): Promise<RawLinkedinProfile>;

  /** Sends a connection request, with an optional note. */
  sendInvitation(
    accountId: string,
    memberId: string,
    note?: string,
  ): Promise<LinkedinInvitationSent>;
}

/** What a hosted connect link needs from us. */
export interface LinkedinConnectLinkRequest {
  /** Our own label for the account, echoed back when the account connects. */
  readonly accountLabel: string;
  /** After this moment the link stops working; links are made per attempt. */
  readonly expiresAt: Date;
  /** Where the vendor reports the newly connected account's id. */
  readonly notifyUrl?: string;
  readonly successRedirectUrl?: string;
  readonly failureRedirectUrl?: string;
}

/** One page request for a people search. */
export interface LinkedinSearchRequest {
  /** A LinkedIn people-search URL, copied from the browser. */
  readonly searchUrl: string;
  /** The cursor from the previous page; absent for the first page. */
  readonly cursor?: string;
  /** Results wanted per page; the vendor caps it by search type. */
  readonly limit?: number;
}

/** How far a person is from the searching account in LinkedIn's network. */
export type LinkedinNetworkDistance = 'first' | 'second' | 'third' | 'outOfNetwork';

/** One person in a search result, as much as the result page shows. */
export interface LinkedinPerson {
  readonly memberId: string;
  readonly publicIdentifier?: string;
  readonly profileUrl?: string;
  readonly name?: string;
  readonly headline: string;
  readonly location?: string;
  readonly networkDistance: LinkedinNetworkDistance;
  /** True when a connection request to this person is already waiting. */
  readonly pendingInvitation?: boolean;
}

/** One page of people, with the cursor for the next. */
export interface LinkedinSearchPage {
  readonly people: readonly LinkedinPerson[];
  /** Absent on the last page. */
  readonly nextCursor?: string;
  /** Total matches LinkedIn reports for the whole search, when it reports one. */
  readonly totalCount?: number;
}

/** A vendor's full-profile record, tagged with which vendor produced it. */
export interface RawLinkedinProfile {
  readonly provider: string;
  readonly record: Record<string, unknown>;
}

/** Confirmation of a sent connection request. */
export interface LinkedinInvitationSent {
  readonly invitationId: string;
}
