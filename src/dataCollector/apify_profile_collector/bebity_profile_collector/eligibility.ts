import { linkedinProfileKey } from '../../../linkedin/index.js';

/**
 * Letters (including accented ones), digits, and hyphens.
 *
 * `\p{M}` covers combining marks for the rare accent that has no composed
 * form; `linkedinProfileKey` already normalizes to NFC, so most accents
 * arrive as a single `\p{L}` code point.
 */
const BEBITY_COMPATIBLE_SLUG_PATTERN = /^[\p{L}\p{M}0-9-]+$/u;

/**
 * Returns whether Bebity's actor can resolve this profile URL.
 *
 * Bebity's actor used to truncate a vanity slug at the first character outside
 * a-z, 0-9, and `-`, which either matched no profile or, worse, matched an
 * unrelated LinkedIn member holding that shorter slug. Bebity has since fixed
 * that for accented letters, verified live: `césar-briceño-44b3562b` and every
 * other accented slug tested now come back with the full slug intact.
 *
 * Non-letter characters still truncate. Verified live, one URL per class
 * present in real data — `®`, emoji with a zero-width joiner, a zero-width
 * space, and a right single quotation mark — every one of them still fails,
 * while an accented control succeeded in the same batch. So the cut is now
 * letters-versus-symbols rather than ASCII-versus-everything, which is what
 * moves the overwhelming majority of accented Brazilian names onto the
 * cheaper provider instead of Harvest.
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
