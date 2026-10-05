import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { OpenRouter } from '@openrouter/sdk';

import { asRecord, asString } from '../helpers/type_guards.js';

/**
 * Environment variables the rest of the application reads its secrets from.
 *
 * The model client reads `process.env` at call time rather than at startup,
 * so putting a key here reaches it without a restart and without it knowing
 * the key can now arrive from a browser.
 */
const CREDENTIAL_ENVIRONMENT_KEYS = {
  openRouter: 'OPENROUTER_API_KEY',
} as const;

/** Which service a credential belongs to. */
export type CredentialService = keyof typeof CREDENTIAL_ENVIRONMENT_KEYS;

/** Where remembered keys are written when the operator asks for that. */
const REMEMBERED_CREDENTIALS_PATH = 'src/dataStorage/credentials.json';

/** Characters of a key shown back, enough to tell two keys apart. */
const KEY_TAIL_LENGTH = 4;

/** One service's credential state, safe to send to the browser. */
export interface CredentialState {
  configured: boolean;
  /** Last few characters, so a wrong paste is recognizable without exposing the key. */
  tail?: string;
  /** Whether this key is on disk and will survive a restart. */
  remembered: boolean;
}

/** What the setup screen needs to decide whether to prompt. */
export interface CredentialsStatus {
  openRouter: CredentialState;
  /** True when every service has a key, whatever its source. */
  ready: boolean;
}

/** A live check of one key against the service that issued it. */
export interface CredentialCheck {
  valid: boolean;
  /** Operator-facing reason, present when the key was rejected. */
  error?: string;
  /** Spend left on the key, when the service reports one. */
  remainingCredit?: number;
  /** Account or key label, so the operator can confirm which account answered. */
  label?: string;
}

/** Every service checked at once, as the setup screen reports them. */
export interface CredentialsCheck {
  openRouter: CredentialCheck;
}

/** Keys submitted together from the setup screen. */
export interface CredentialsInput {
  openRouter?: string | undefined;
}

/** Reads the credentials currently in effect, whatever put them there. */
export function credentialsStatus(): CredentialsStatus {
  const remembered = readRememberedCredentials();
  const state = (service: CredentialService): CredentialState => {
    const key = currentKey(service);
    return {
      configured: Boolean(key),
      ...(key ? { tail: key.slice(-KEY_TAIL_LENGTH) } : {}),
      remembered: Boolean(remembered[service]),
    };
  };

  const openRouter = state('openRouter');

  return { openRouter, ready: openRouter.configured };
}

/**
 * Puts submitted keys into effect, optionally keeping them across restarts.
 *
 * Writing to `process.env` is what makes this reach the model client: it
 * reads it per call, so a key pasted mid-session applies to the next run
 * without a restart. Remembering is a deliberate choice rather
 * than the default, so a shared machine can be left holding nothing.
 */
export function applyCredentials(
  input: CredentialsInput,
  remember: boolean,
): CredentialsStatus {
  for (const service of credentialServices()) {
    const submitted = input[service]?.trim();
    if (submitted) process.env[CREDENTIAL_ENVIRONMENT_KEYS[service]] = submitted;
  }

  if (remember) {
    rememberCredentials({ openRouter: currentKey('openRouter') });
  } else {
    forgetCredentials();
  }

  return credentialsStatus();
}

/** Drops remembered keys from disk, leaving the running process untouched. */
export function forgetCredentials(): void {
  try {
    rmSync(REMEMBERED_CREDENTIALS_PATH, { force: true });
  } catch {
    // A key that cannot be deleted is reported by the next status read; the
    // caller's own request still succeeded.
  }
}

/**
 * Loads remembered keys at startup without overriding a configured
 * environment.
 *
 * A key already in `.env` or the shell is the operator's explicit choice for
 * this process, so it wins over whatever the browser saved earlier.
 */
export function loadRememberedCredentials(): void {
  const remembered = readRememberedCredentials();

  for (const service of credentialServices()) {
    const key = remembered[service];
    if (key && !currentKey(service)) {
      process.env[CREDENTIAL_ENVIRONMENT_KEYS[service]] = key;
    }
  }
}

/**
 * Checks the key against the service that issued it.
 *
 * Done before a campaign rather than during one: a rejected key otherwise
 * surfaces only once the first evaluation request fails.
 */
export async function checkCredentials(): Promise<CredentialsCheck> {
  return { openRouter: await checkOpenRouterKey(currentKey('openRouter')) };
}

/**
 * Confirms an OpenRouter key and reads what is left to spend on it.
 *
 * Uses the current-key endpoint rather than the credits one: credits needs a
 * management key, while this answers for the ordinary inference key an
 * operator pastes. `limitRemaining` is null when no spend limit is set on the
 * key, which is a valid key with no figure to show rather than an error.
 */
async function checkOpenRouterKey(
  apiKey: string | undefined,
): Promise<CredentialCheck> {
  if (!apiKey) {
    return { valid: false, error: 'No OpenRouter key has been entered yet.' };
  }

  try {
    const response = await new OpenRouter({ apiKey }).apiKeys
      .getCurrentKeyMetadata();
    const data = asRecord(asRecord(response)?.['data']);
    const remaining = data?.['limitRemaining'];
    const label = asString(data?.['label']);

    return {
      valid: true,
      ...(typeof remaining === 'number' ? { remainingCredit: remaining } : {}),
      ...(label ? { label } : {}),
    };
  } catch (error: unknown) {
    return { valid: false, error: credentialErrorMessage(error, 'OpenRouter') };
  }
}

/** Turns a rejected credential into something an operator can act on. */
function credentialErrorMessage(error: unknown, service: string): string {
  const message = error instanceof Error ? error.message : String(error);

  // A bad token can be phrased as a missing user rather than a refused
  // credential, so the rejection is recognized by its wording as well as by a
  // status code. Anything else is reported verbatim: an outage and a typo need
  // different actions, and guessing between them helps nobody.
  if (/401|unauthor|not valid|invalid|not found/i.test(message)) {
    return `${service} rejected this key. Check that it was copied in full.`;
  }

  return `Could not reach ${service}: ${message}`;
}

/** The services this module manages, as a reusable iteration source. */
function credentialServices(): CredentialService[] {
  return Object.keys(CREDENTIAL_ENVIRONMENT_KEYS) as CredentialService[];
}

/** Reads one service's key from the environment, treating blanks as absent. */
function currentKey(service: CredentialService): string | undefined {
  return process.env[CREDENTIAL_ENVIRONMENT_KEYS[service]]?.trim() || undefined;
}

/** Writes remembered keys, creating the storage directory on first use. */
function rememberCredentials(keys: Record<CredentialService, string | undefined>): void {
  mkdirSync(dirname(REMEMBERED_CREDENTIALS_PATH), { recursive: true });
  writeFileSync(
    REMEMBERED_CREDENTIALS_PATH,
    JSON.stringify(keys, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  );
}

/** Reads remembered keys, treating an absent or unreadable file as none. */
function readRememberedCredentials(): Partial<Record<CredentialService, string>> {
  try {
    const parsed = asRecord(
      JSON.parse(readFileSync(REMEMBERED_CREDENTIALS_PATH, 'utf8')),
    );
    if (!parsed) return {};

    const keys: Partial<Record<CredentialService, string>> = {};
    for (const service of credentialServices()) {
      const key = asString(parsed[service])?.trim();
      if (key) keys[service] = key;
    }

    return keys;
  } catch {
    return {};
  }
}
