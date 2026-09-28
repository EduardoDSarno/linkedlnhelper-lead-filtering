import { UnipileClient } from 'unipile-node-sdk';

import { asRecord, asString } from '../../shared/helpers/index.js';
import type {
  LinkedinConnectLinkRequest,
  LinkedinInvitationSent,
  LinkedinNetworkDistance,
  LinkedinPerson,
  LinkedinProvider,
  LinkedinSearchPage,
  LinkedinSearchRequest,
  RawLinkedinProfile,
} from '../linkedin_provider.js';
import { requireUnipileWorkspace } from './config.js';
import type { UnipileWorkspace } from './config.js';

/** Tag on every raw profile this adapter returns, naming where it came from. */
export const UNIPILE_PROFILE_PROVIDER = 'unipile';

/**
 * Profile sections fetched per person.
 *
 * Fetching every section is the request LinkedIn is most likely to throttle at
 * volume, so only what evaluation reads is asked for.
 */
const PROFILE_SECTIONS: ('experience' | 'education')[] = ['experience', 'education'];

/** Unipile's name for LinkedIn in a hosted connect link's provider list. */
const LINKEDIN_PROVIDER = 'LINKEDIN';

/** Unipile's network-distance values mapped onto ours. */
const NETWORK_DISTANCE: Readonly<Record<string, LinkedinNetworkDistance>> = {
  DISTANCE_1: 'first',
  DISTANCE_2: 'second',
  DISTANCE_3: 'third',
  OUT_OF_NETWORK: 'outOfNetwork',
};

/**
 * The part of the SDK this adapter calls.
 *
 * Declared as a slice rather than the whole client so tests can hand in a fake
 * that records calls, and never reach Unipile or a LinkedIn account.
 */
export interface UnipileSdk {
  account: Pick<UnipileClient['account'], 'createHostedAuthLink'>;
  users: Pick<UnipileClient['users'], 'getProfile' | 'sendInvitation'>;
  request: Pick<UnipileClient['request'], 'send'>;
}

/**
 * Builds the LinkedIn provider backed by Unipile.
 *
 * The SDK wraps connect links, profiles, and invitations. It predates the
 * search and proxy-country endpoints, so those two go through its raw request
 * sender, which still carries the workspace's address and token.
 */
export function createUnipileProvider(
  options: { workspace?: UnipileWorkspace; sdk?: UnipileSdk } = {},
): LinkedinProvider {
  const workspace = options.workspace ?? requireUnipileWorkspace();
  const sdk =
    options.sdk ?? new UnipileClient(workspace.baseUrl, workspace.accessToken);

  return {
    async createConnectLink(request: LinkedinConnectLinkRequest): Promise<string> {
      const response = await sdk.account.createHostedAuthLink({
        type: 'create',
        providers: [LINKEDIN_PROVIDER],
        api_url: workspace.baseUrl,
        expiresOn: request.expiresAt.toISOString(),
        name: request.accountLabel,
        ...(request.notifyUrl ? { notify_url: request.notifyUrl } : {}),
        ...(request.successRedirectUrl
          ? { success_redirect_url: request.successRedirectUrl }
          : {}),
        ...(request.failureRedirectUrl
          ? { failure_redirect_url: request.failureRedirectUrl }
          : {}),
      });
      return response.url;
    },

    async setAccountCountry(accountId: string, countryCode: string): Promise<void> {
      await sdk.request.send({
        method: 'PATCH',
        path: ['accounts', accountId],
        body: { country: countryCode.toUpperCase() },
      });
    },

    async searchPeople(
      accountId: string,
      request: LinkedinSearchRequest,
    ): Promise<LinkedinSearchPage> {
      const response = await sdk.request.send<unknown>({
        method: 'POST',
        path: ['linkedin', 'search'],
        parameters: {
          account_id: accountId,
          ...(request.cursor ? { cursor: request.cursor } : {}),
          ...(request.limit ? { limit: String(request.limit) } : {}),
        },
        body: { url: request.searchUrl },
      });
      return searchPage(response);
    },

    async getProfile(accountId: string, memberId: string): Promise<RawLinkedinProfile> {
      const response = await sdk.users.getProfile({
        account_id: accountId,
        identifier: memberId,
        linkedin_sections: PROFILE_SECTIONS,
        // A profile view the person is told about is a visible trace of
        // automation, and it tells them nothing they asked for.
        notify: false,
      });
      return {
        provider: UNIPILE_PROFILE_PROVIDER,
        record: asRecord(response) ?? {},
      };
    },

    async sendInvitation(
      accountId: string,
      memberId: string,
      note?: string,
    ): Promise<LinkedinInvitationSent> {
      const response = await sdk.users.sendInvitation({
        account_id: accountId,
        provider_id: memberId,
        ...(note ? { message: note } : {}),
      });
      return { invitationId: response.invitation_id };
    },
  };
}

/**
 * Reads one page of a Unipile search response.
 *
 * A search URL can mix result kinds; only people become `LinkedinPerson`s, and
 * an entry without a member id is skipped because nothing can be done with it.
 */
function searchPage(response: unknown): LinkedinSearchPage {
  const record = asRecord(response);
  const items = Array.isArray(record?.['items']) ? record['items'] : [];
  const people = items.flatMap((item) => {
    const person = linkedinPerson(item);
    return person ? [person] : [];
  });

  const nextCursor = asString(record?.['cursor']);
  const totalCount = asRecord(record?.['paging'])?.['total_count'];

  return {
    people,
    ...(nextCursor ? { nextCursor } : {}),
    ...(typeof totalCount === 'number' ? { totalCount } : {}),
  };
}

/** Maps one search entry onto a person, or nothing when it is not one. */
function linkedinPerson(value: unknown): LinkedinPerson | undefined {
  const item = asRecord(value);
  const memberId = asString(item?.['id']);
  if (!item || item['type'] !== 'PEOPLE' || !memberId) return undefined;

  const publicIdentifier = asString(item['public_identifier']);
  const profileUrl =
    asString(item['public_profile_url']) ?? asString(item['profile_url']);
  const name = asString(item['name']);
  const location = asString(item['location']);
  const pendingInvitation = item['pending_invitation'];

  return {
    memberId,
    headline: asString(item['headline']) ?? '',
    networkDistance:
      NETWORK_DISTANCE[asString(item['network_distance']) ?? ''] ?? 'outOfNetwork',
    ...(publicIdentifier ? { publicIdentifier } : {}),
    ...(profileUrl ? { profileUrl } : {}),
    ...(name ? { name } : {}),
    ...(location ? { location } : {}),
    ...(typeof pendingInvitation === 'boolean' ? { pendingInvitation } : {}),
  };
}
