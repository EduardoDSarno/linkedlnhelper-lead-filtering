/**
 * The API the screens actually call.
 *
 * It forwards to the real backend client in `api.ts`, unless the page was opened
 * with `?mock` in the URL, in which case the in-browser mock is used. Keeping
 * the choice here means components and the flow hook never know which is active.
 */
import * as real from './api';
import * as mock from './mock';

const client = mock.MOCK_ENABLED ? mock : real;

export const importCsv = client.importCsv;
export const startReview = client.startReview;
export const getStatus = client.getStatus;
export const getResults = client.getResults;
export const submitDecisions = client.submitDecisions;
export const startDownload = client.startDownload;
export const listRuns = client.listRuns;
export const renameRun = client.renameRun;
export const deleteRun = client.deleteRun;
