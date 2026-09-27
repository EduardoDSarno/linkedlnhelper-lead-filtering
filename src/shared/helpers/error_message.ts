/**
 * Converts an unknown thrown value into a log-safe message string.
 *
 * A `catch` clause receives `unknown` because JavaScript can throw any value,
 * so the message is read only after confirming the value is an Error and every
 * other value is stringified.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
