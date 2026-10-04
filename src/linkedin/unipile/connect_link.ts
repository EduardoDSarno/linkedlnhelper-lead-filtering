import { asRecord, asString } from '../../shared/helpers/index.js';
import type { UnipileConfig } from './config.js';
import { sendUnipileRequest } from './request.js';
import type { FetchFunction } from './request.js';

/** Unipile's name for LinkedIn in a connect link's provider list. */
const LINKEDIN_PROVIDER = 'LINKEDIN';

/** What a connect link needs from us. */
export interface ConnectLinkRequest {
  /**
   * Our own id for the account being connected. Unipile echoes it back to
   * `notifyUrl`, which is how we know which account just connected.
   */
  readonly accountLabel: string;
  /** The link stops working after this; Unipile also expires links daily. */
  readonly expiresAt: Date;
  /** Where Unipile reports the new account's id once the login succeeds. */
  readonly notifyUrl?: string;
  readonly successRedirectUrl?: string;
  readonly failureRedirectUrl?: string;
}



/**
 * Creates a hosted login link for connecting one LinkedIn account.
 *
 * The person opens the link and logs into LinkedIn on Unipile's page, so our
 * server never sees their password; LinkedIn's own checks (2FA, captcha) are
 * handled there too. The link connects LinkedIn only.
 *
 * @returns The URL to send the person to.
 * @throws When Unipile's reply carries no URL.
 */
export async function createConnectLink(
  workspace: UnipileConfig,
  request: ConnectLinkRequest,
  fetchFunction?: FetchFunction,
): Promise<string> {
  const response = await sendUnipileRequest(
    workspace,
    {
      method: 'POST',
      path: '/hosted/accounts/link',
      body: {
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
      },
    },
    fetchFunction,
  );

  const url = asString(asRecord(response)?.['url']);
  if (!url) throw new Error('Unipile created no connect link URL.');
  return url;
}


/** The login results we act on; anything else is rejected. */
const ACCOUNT_CONNECTED_STATUSES = ['CREATION_SUCCESS', 'RECONNECTED'] as const;
type AccountConnectedStatus = (typeof ACCOUNT_CONNECTED_STATUSES)[number];

/** Unipile's "a login finished" message, after it has been checked. */
export interface AccountConnectedEvent {
  readonly status: AccountConnectedStatus;
  readonly accountId: string;  // Unipile's id for the LinkedIn account
  readonly label: string;      // the label you sent when creating the link
}


/**
 * This function will be responsible for getting the body,
 * parsing it and checking if the connection is valid or not it will
 * only return if it is valid
 */
export function checkConnectionReply(body: unknown): AccountConnectedEvent
{

    const record = asRecord(body);
    const accountId = asString(record?.['account_id']);
    const label = asString(record?.['name']);

    const status = ACCOUNT_CONNECTED_STATUSES.find(
      (value) => value === record?.['status'],
    );
     if (!accountId || !label || !status) {                          // 4
      throw new Error('Not a valid Unipile account-connected message.');
    }
    return { status, accountId, label };                            // 5
}

