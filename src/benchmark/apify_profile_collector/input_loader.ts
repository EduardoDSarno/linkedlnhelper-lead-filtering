import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { parse } from 'csv-parse/sync';

import { DIRECT_LINK_SOURCE_PATH } from './constants.js';
import type {
  ApifyBenchmarkArguments,
  ApifyBenchmarkExpectedIdentity,
  LoadedApifyBenchmarkInput,
} from './types.js';

const TEXT_FILE_EXTENSION = '.txt';
const JSON_FILE_EXTENSION = '.json';
const CSV_FILE_EXTENSION = '.csv';
const COMMA_DELIMITER = ',';
const SEMICOLON_DELIMITER = ';';

const URL_FIELD_NAMES = [
  'linkedinUrl',
  'linkedin_url',
  'profileUrl',
  'profile_url',
  'url',
] as const;
const FULL_NAME_FIELD_NAMES = ['fullName', 'full_name', 'name'] as const;
const FIRST_NAME_FIELD_NAMES = ['firstName', 'first_name'] as const;
const LAST_NAME_FIELD_NAMES = ['lastName', 'last_name'] as const;

interface ParsedProfileLink {
  linkedinUrl: string;
  expectedIdentity?: ApifyBenchmarkExpectedIdentity;
}

/**
 * Returns the first non-empty string found under a list of accepted field names.
 *
 * @param record - Generic JSON or CSV record.
 * @param fieldNames - Supported aliases in priority order.
 * @returns A trimmed value or undefined when every alias is absent.
 */
function firstStringValue(
  record: Readonly<Record<string, unknown>>,
  fieldNames: readonly string[],
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Ensures link-only inputs contain LinkedIn profile URLs rather than arbitrary
 * strings that could create unintended provider requests.
 *
 * @param value - Candidate URL from the CLI or an input file.
 * @returns The trimmed LinkedIn profile URL.
 * @throws When the value is not an HTTP LinkedIn profile URL.
 */
function requireLinkedinProfileUrl(value: string): string {
  const trimmed = value.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error(`Invalid LinkedIn profile URL: ${value}`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isLinkedinHost =
    hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
  if (!isLinkedinHost || !parsedUrl.pathname.toLowerCase().startsWith('/in/')) {
    throw new Error(`Invalid LinkedIn profile URL: ${value}`);
  }
  return trimmed;
}

/**
 * Converts a generic object into a profile URL and optional expected identity.
 *
 * @param record - CSV or JSON record using any supported field aliases.
 * @returns Parsed profile input.
 * @throws When the record has no supported LinkedIn URL field.
 */
function profileLinkFromRecord(
  record: Readonly<Record<string, unknown>>,
): ParsedProfileLink {
  const linkedinUrl = firstStringValue(record, URL_FIELD_NAMES);
  if (!linkedinUrl) {
    throw new Error(
      `A profile record must contain one of: ${URL_FIELD_NAMES.join(', ')}.`,
    );
  }

  const validatedUrl = requireLinkedinProfileUrl(linkedinUrl);
  const fullName = firstStringValue(record, FULL_NAME_FIELD_NAMES);
  const firstName = firstStringValue(record, FIRST_NAME_FIELD_NAMES);
  const lastName = firstStringValue(record, LAST_NAME_FIELD_NAMES);
  const hasIdentity = Boolean(fullName || firstName || lastName);

  return {
    linkedinUrl: validatedUrl,
    ...(hasIdentity
      ? {
          expectedIdentity: {
            linkedinUrl: validatedUrl,
            ...(fullName ? { fullName } : {}),
            ...(firstName ? { firstName } : {}),
            ...(lastName ? { lastName } : {}),
          },
        }
      : {}),
  };
}

/**
 * Detects the delimiter used by the first CSV row without assuming the source
 * is a Linked Helper export.
 *
 * @param text - Complete CSV document.
 * @returns The delimiter occurring most often in the header row.
 */
function detectCsvDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const commaCount = firstLine.split(COMMA_DELIMITER).length;
  const semicolonCount = firstLine.split(SEMICOLON_DELIMITER).length;
  return semicolonCount > commaCount ? SEMICOLON_DELIMITER : COMMA_DELIMITER;
}

/**
 * Detects the richer Linked Helper schema so its established importer can
 * provide optional expected names without coupling other inputs to that model.
 *
 * @param headers - Parsed CSV header names.
 * @returns True when characteristic Linked Helper columns are present.
 */
function isLinkedHelperCsv(headers: readonly string[]): boolean {
  const headerSet = new Set(headers);
  return (
    headerSet.has('profile_url') &&
    headerSet.has('public_id') &&
    headerSet.has('lh_id')
  );
}

/**
 * Splits parsed inputs into the URL list required by Apify and optional identity
 * evidence used only after collection.
 *
 * @param parsedProfiles - Validated inputs from one adapter.
 * @param sourceKind - Adapter kind persisted in the benchmark plan.
 * @param sourcePath - File path or command-line label persisted in the plan.
 * @returns Uniform benchmark input independent of the original file format.
 */
function loadedInput(
  parsedProfiles: readonly ParsedProfileLink[],
  sourceKind: LoadedApifyBenchmarkInput['sourceKind'],
  sourcePath: string,
): LoadedApifyBenchmarkInput {
  if (parsedProfiles.length === 0) {
    throw new Error('The benchmark input does not contain any profile links.');
  }
  return {
    sourceKind,
    sourcePath,
    profileLinks: parsedProfiles.map((profile) => profile.linkedinUrl),
    expectedIdentities: parsedProfiles
      .map((profile) => profile.expectedIdentity)
      .filter(
        (identity): identity is ApifyBenchmarkExpectedIdentity =>
          identity !== undefined,
      ),
  };
}

/**
 * Loads a text file containing one LinkedIn profile URL per non-empty line.
 *
 * @param path - Text file path.
 * @returns Uniform link-only benchmark input.
 */
async function loadTextLinks(path: string): Promise<LoadedApifyBenchmarkInput> {
  const text = await readFile(path, 'utf8');
  const parsedProfiles = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((linkedinUrl) => ({
      linkedinUrl: requireLinkedinProfileUrl(linkedinUrl),
    }));
  return loadedInput(parsedProfiles, 'link_file', path);
}

/**
 * Loads a JSON array containing URL strings or objects with supported fields.
 *
 * @param path - JSON file path.
 * @returns Uniform benchmark input with optional names from object entries.
 * @throws When the root is not an array or an entry has an unsupported shape.
 */
async function loadJsonLinks(path: string): Promise<LoadedApifyBenchmarkInput> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('A benchmark JSON input must contain an array.');
  }
  const parsedProfiles = parsed.map((entry) => {
    if (typeof entry === 'string') {
      return { linkedinUrl: requireLinkedinProfileUrl(entry) };
    }
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      return profileLinkFromRecord(entry as Record<string, unknown>);
    }
    throw new Error('Each benchmark JSON entry must be a URL or an object.');
  });
  return loadedInput(parsedProfiles, 'link_file', path);
}

/**
 * Loads either a Linked Helper export or a small CSV containing a URL column.
 * Only URL and optional name columns are read; no domain profile is created.
 *
 * @param path - CSV file path.
 * @returns Uniform benchmark input with optional expected names.
 */
async function loadCsvLinks(path: string): Promise<LoadedApifyBenchmarkInput> {
  const text = await readFile(path, 'utf8');
  const delimiter = detectCsvDelimiter(text);
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    delimiter,
  }) as Record<string, string>[];
  const headers = records[0] ? Object.keys(records[0]) : [];

  const parsedProfiles = records.map(profileLinkFromRecord);
  return loadedInput(
    parsedProfiles,
    isLinkedHelperCsv(headers) ? 'linked_helper_csv' : 'link_file',
    path,
  );
}

/**
 * Selects the correct independent input adapter for direct URLs or a file.
 *
 * @param arguments_ - Parsed benchmark CLI arguments.
 * @returns Uniform links plus optional expected identity evidence.
 * @throws For unsupported extensions, invalid URLs, or malformed files.
 */
export async function loadApifyBenchmarkInput(
  arguments_: ApifyBenchmarkArguments,
): Promise<LoadedApifyBenchmarkInput> {
  if (arguments_.profileLinks.length > 0) {
    return loadedInput(
      arguments_.profileLinks.map((linkedinUrl) => ({
        linkedinUrl: requireLinkedinProfileUrl(linkedinUrl),
      })),
      'direct_links',
      DIRECT_LINK_SOURCE_PATH,
    );
  }

  const inputPath = arguments_.inputPath;
  if (!inputPath) throw new Error('The benchmark input path is missing.');
  const extension = extname(inputPath).toLowerCase();

  if (extension === TEXT_FILE_EXTENSION) return loadTextLinks(inputPath);
  if (extension === JSON_FILE_EXTENSION) return loadJsonLinks(inputPath);
  if (extension === CSV_FILE_EXTENSION) return loadCsvLinks(inputPath);

  throw new Error(
    `Unsupported benchmark input format: ${extension || 'no extension'}.`,
  );
}
