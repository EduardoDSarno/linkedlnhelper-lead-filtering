import { asRecord } from '../../shared/helpers/index.js';
import type { UnipileWorkspace } from './config.js';
import type { ConnectLinkRequest } from './connect_link.js';
import {createConnectLink} from './connect_link.js'
import type {FetchFunction, UnipileRequest, } from './request.ts'
import {UnipileRequestError} from './request.js'


interface UnipileAccount{
   connectionStatus: 'CREATION_SUCCESS' | 'RECONNECTED';
    accountId: string,
    label:string,
    account_status: 'OK'| 'CREDENTIALS'| 'ERROR' | 'STOPPED';
    name: string;
    connectedAt: number;
}


export async function createAccount(
  workspace: UnipileWorkspace,
  request: ConnectLinkRequest,
  fetchFunction?: FetchFunction){


  let response =  await createConnectLink(workspace, request,fetchFunction);

  const record = asRecord(response);

}
