import { linkedinProfileKey } from '../../../linkedin/index.js';

const BEBITY_COMPATIBLE_SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Returns whether Bebity's actor can resolve this profile URL.
 *
 * Confirmed against live Bebity responses: its actor truncates a vanity slug
 * at the first character outside a-z, 0-9, and `-` before matching it against
 * LinkedIn's index. A truncated slug either matches no profile or, worse,
 * matches an unrelated LinkedIn member who happens to hold that shorter slug.
 * Percent-encoding the offending character does not help — encoded and raw
 * input were verified to truncate at the identical position, so there is no
 * request-side workaround; those profiles must go through Harvest instead.
 */
export function isBebityCompatibleProfileUrl(url: string): boolean {
  const slug = linkedinProfileKey(url);
  return slug !== undefined && BEBITY_COMPATIBLE_SLUG_PATTERN.test(slug);
}

export interface BebityProfileLinkPartition {
  bebityCompatible: string[];
  requiresHarvest: string[];
}

/** Splits profile links by whether Bebity can resolve them without truncation. */
export function partitionProfileLinksForBebity(
  profileLinks: readonly string[],
): BebityProfileLinkPartition {
  const bebityCompatible: string[] = [];
  const requiresHarvest: string[] = [];
  for (const url of profileLinks) {
    (isBebityCompatibleProfileUrl(url) ? bebityCompatible : requiresHarvest).push(url);
  }
  return { bebityCompatible, requiresHarvest };
}
