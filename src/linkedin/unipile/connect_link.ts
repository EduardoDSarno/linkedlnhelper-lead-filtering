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
