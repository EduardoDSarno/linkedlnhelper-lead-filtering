import type { Logger as PinoLogger } from 'pino';

/**
 * The structured logger every stage accepts.
 *
 * Kept as pino's type so the caller decides where lines go; the stages only
 * log, they never construct a logger themselves.
 */
export type Logger = PinoLogger;

export {
  EVALUATION_PASS,
  PIPELINE_PROGRESS_MESSAGE,
  PIPELINE_STAGE,
  displayIndex,
  displayRange,
  elapsedMs,
} from './progress.js';
export type { EvaluationPass } from './progress.js';
