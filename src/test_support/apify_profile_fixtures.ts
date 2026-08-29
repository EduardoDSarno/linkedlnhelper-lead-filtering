import type { RawApifyProfile } from '../dataCollector/apify_profile_collector/index.js';

/**
 * Anonymized provider-shaped Apify payloads for deterministic tests.
 *
 * Every value here is invented. The shapes mirror real HarvestAPI records so
 * mapping is exercised against realistic structure, but no real person, URL,
 * or photo is committed to the repository.
 *
 * Each builder returns a fresh object, so a test that mutates a fixture cannot
 * leak into another test.
 */

/**
 * Field the mapper is expected to ignore while preserving it inside `raw`.
 *
 * Asserting on this sentinel is how tests prove normalization copies nothing
 * out of the provider payload and trims nothing off it.
 */
export const RAW_ONLY_SENTINEL = 'rawOnlyProviderField';

/** Builds a payload carrying every field the normalized Profile can hold. */
export function completeApifyProfile(): RawApifyProfile {
  return {
    linkedinUrl: 'https://www.linkedin.com/in/test-person-001',
    firstName: 'Avery',
    lastName: 'Stone',
    headline: 'Operations Lead at Example Logistics',
    photo: 'https://example.invalid/photos/test-person-001.jpg',
    openToWork: true,
    location: {
      linkedinText: 'Lisbon, Lisbon, Portugal',
      countryCode: 'PT',
      parsed: {
        text: 'Lisbon, Portugal',
        city: 'Lisbon',
        state: 'Lisbon',
        country: 'Portugal',
        countryCode: 'PT',
      },
    },
    experience: [
      {
        position: 'Operations Lead',
        companyName: 'Example Logistics',
        location: 'Lisbon, Portugal',
        startDate: { year: 2021, month: 3, text: 'Mar 2021' },
        endDate: { text: 'Present' },
      },
      {
        position: 'Operations Analyst',
        companyName: 'Sample Freight',
        location: 'Porto, Portugal',
        startDate: { year: 2018, month: 'September' },
        endDate: { year: 2021, month: 2 },
      },
    ],
    education: [
      {
        schoolName: 'Example University',
        degree: 'BSc',
        fieldOfStudy: 'Industrial Engineering',
        startDate: { year: 2014 },
        endDate: { year: 2018 },
      },
    ],
    [RAW_ONLY_SENTINEL]: 'provider-only value the mapper must not touch',
  };
}

/** Builds the minimum payload the mapper accepts: identity only. */
export function sparseApifyProfile(): RawApifyProfile {
  return {
    linkedinUrl: 'https://www.linkedin.com/in/test-person-002',
  };
}

/** Builds a payload the mapper must reject, because identity is missing. */
export function malformedApifyProfile(): RawApifyProfile {
  return {
    firstName: 'Nointent',
    headline: 'Missing the required LinkedIn URL',
  };
}

/**
 * Builds a payload whose employment entries exercise deduplication.
 *
 * The first two entries are the same job written with different spacing and
 * casing, so they must collapse. Every later entry differs in exactly one
 * identity component, so all of them must survive as separate jobs.
 */
export function duplicateEmploymentApifyProfile(): RawApifyProfile {
  return {
    linkedinUrl: 'https://www.linkedin.com/in/test-person-003',
    experience: [
      {
        position: 'Operations Lead',
        companyName: 'Example Logistics',
        startDate: { year: 2021, month: 3 },
      },
      {
        position: '  operations   lead  ',
        companyName: 'EXAMPLE LOGISTICS',
        startDate: { year: 2021, month: 3 },
      },
      {
        position: 'Operations Lead',
        companyName: 'Sample Freight',
        startDate: { year: 2021, month: 3 },
      },
      {
        position: 'Operations Director',
        companyName: 'Example Logistics',
        startDate: { year: 2021, month: 3 },
      },
      {
        position: 'Operations Lead',
        companyName: 'Example Logistics',
        startDate: { year: 2019, month: 3 },
      },
    ],
  };
}

/**
 * Builds a payload with two simultaneous current roles at different companies.
 *
 * Both must survive: an ongoing second job is real employment, not a duplicate.
 */
export function simultaneousCurrentRolesApifyProfile(): RawApifyProfile {
  return {
    linkedinUrl: 'https://www.linkedin.com/in/test-person-004',
    experience: [
      {
        position: 'Operations Lead',
        companyName: 'Example Logistics',
        startDate: { year: 2021 },
        endDate: { text: 'Present' },
      },
      {
        position: 'Advisor',
        companyName: 'Sample Ventures',
        startDate: { year: 2022 },
        endDate: { text: 'Present' },
      },
    ],
  };
}

/**
 * Builds a payload whose employment and education entries lack the fields the
 * normalized arrays require, so every entry must be dropped from the
 * normalized model while remaining reachable through `raw`.
 */
export function incompleteEntriesApifyProfile(): RawApifyProfile {
  return {
    linkedinUrl: 'https://www.linkedin.com/in/test-person-005',
    experience: [
      { position: 'Operations Lead' },
      { companyName: 'Example Logistics' },
      { position: '   ', companyName: 'Example Logistics' },
      'not an object',
    ],
    education: [
      { degree: 'BSc', fieldOfStudy: 'Industrial Engineering' },
      { schoolName: '  ' },
      42,
    ],
  };
}
