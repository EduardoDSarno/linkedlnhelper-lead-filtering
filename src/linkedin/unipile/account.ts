import { asRecord } from '../../shared/helpers/index.js';
import type { UnipileWorkspace } from './config.js';
import type { ConnectLinkRequest } from './connect_link.js';
import {createConnectLink} from './connect_link.js'
import type {FetchFunction, UnipileRequest, } from './request.ts'
import {UnipileRequestError} from './request.js'


/*What Unipile sends your webhook when a login finishes*/
export interface UnipileAccountConnected {
  status: 'CREATION_SUCCESS' | 'RECONNECTED';
  accountId: string;
  label: string;        // the name sent on the link
}

// One account from Unipile's account list
export interface UnipileAccount {
  accountId: string;
  name: string;         // LinkedIn display name
  status: string;       // 'OK', 'CREDENTIALS', 'ERROR', 'STOPPED', …
  connectedAt?: string; // Unipile sends a date as text
}


export async function createAccount(
  workspace: UnipileWorkspace,
  request: ConnectLinkRequest,
  fetchFunction?: FetchFunction){


  let response =  await createConnectLink(workspace, request,fetchFunction);

  const record = asRecord(response);

}
