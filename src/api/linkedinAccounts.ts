import type { FastifyInstance } from "fastify";
import { asRecord, asString } from "../shared/helpers/index.js";
import type {ConnectLinkRequest} from "../linkedin/unipile/connect_link.js";
import {createConnectLink} from "../linkedin/unipile/connect_link.js";
import {HTTP_BAD_REQUEST} from "./consts.js"
import type {UnipileConfig}  from "../linkedin/unipile/config.js";
import type { FetchFunction } from "../linkedin/unipile/index.js";
import { ACCOUNT_CONNECTED_PATH } from "./webhooks/unipile/webhook.js";

const LINKEDIN_ACCOUNTS_CONNECTED_PATH = "/api/linkedin-accounts/connect";
// One hour
const LINK_LIFETIME_MS = 3_600_000;

/** This function will receive a instance of the server, the configs and
 * optionally fetch function for tests. It will return a promise, of the
 * url send to the user. It's job is to build a request rount
 */
export async function registerLinkedinAccountRoute(
    app: FastifyInstance,
    config : UnipileConfig,
    publicUrl: string,
    fetchFunction?: FetchFunction,
)
{
    // Where Unipile reports a finished login: our address plus the webhook path.
    const notifyUrl = `${publicUrl}${ACCOUNT_CONNECTED_PATH}`;

    app.post(LINKEDIN_ACCOUNTS_CONNECTED_PATH, async (request, reply)=>{

        const bodyRecord = asRecord(request.body);
        const label      = asString(bodyRecord?.['label']);

        if (!label)
        {
            return reply.code(HTTP_BAD_REQUEST).send({ error: 'label is required' });
        }

        const connectRequest : ConnectLinkRequest = {
            accountLabel: label,
            expiresAt:    new Date(Date.now() + LINK_LIFETIME_MS),
            notifyUrl,
        }

        // this function returns the url we wll send to the user
        const userUrl = await createConnectLink(config, connectRequest, fetchFunction);
        return { url: userUrl };
    })
}