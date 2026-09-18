/**
 * Rough cost of one campaign, used only to warn before a run starts.
 *
 * Measured from completed runs rather than guessed: a group of three profiles
 * costs about 15,500 tokens all in, split roughly two-thirds prompt to
 * one-third generated. Priced against the per-million ceilings the backend
 * routes under, that lands near a tenth of a cent per profile.
 *
 * Deliberately an over-estimate. The number exists to stop someone starting a
 * 600-profile run on two dollars of credit, and being told a run is affordable
 * when it is not is the failure that costs an afternoon.
 */
const ESTIMATED_USD_PER_PROFILE = 0.0018;

/** Headroom required beyond the estimate before a run is called affordable. */
const CREDIT_SAFETY_MULTIPLIER = 1.5;

/** What one campaign is expected to cost, in USD. */
export function estimatedRunCost(profiles: number): number {
  return profiles * ESTIMATED_USD_PER_PROFILE;
}

/**
 * Decides whether the remaining credit comfortably covers a run.
 *
 * An unknown balance is treated as sufficient: OpenRouter reports no figure
 * for a key with no spend limit set, and a warning shown to everyone who never
 * set a limit would be noise rather than a signal.
 */
export function creditCoversRun(
  remainingCredit: number | undefined,
  profiles: number,
): boolean {
  if (typeof remainingCredit !== 'number') return true;
  return remainingCredit >= estimatedRunCost(profiles) * CREDIT_SAFETY_MULTIPLIER;
}
