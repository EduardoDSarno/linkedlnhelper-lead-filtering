import { CONFIG_NUMBER_MINIMUMS, resolveConfigNumber } from "../shared/helpers/index.js";

/** How the collection pipeline paces itself; every value can be set in `.env`. */
export interface PipelineConfig {
  /** Profiles gathered before they are sent to evaluation together. */
  evaluationBatchSize: number;
  /** A stored profile younger than this is reused instead of fetched again. */
  profileRefreshDays: number;
  /** Failed fetches before a lead is marked failed. */
  maximumFetchAttempts: number;
  /** Search pages per campaign per pass, so searching is spread over the day. */
  searchPagesPerPass: number;
  /** Rest between two passes over the active campaigns. */
  passIntervalMs: number;
  /** How often each account's agent is woken for a scheduled check-in. */
  agentWakeIntervalMs: number;
  /** Random pause before each LinkedIn action, between these two bounds. */
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  /** Working time, in the accounts' timezone: LinkedIn actions only happen inside it. */
  workTimezone: string;
  workStartHour: number;
  workEndHour: number;
  /** ISO weekdays, Monday = 1 through Sunday = 7. */
  workDays: number[];
}

/** Each setting's environment variable and default. */
const SETTINGS = {
  evaluationBatchSize: { key: "PIPELINE_EVALUATION_BATCH_SIZE", fallback: 50 },
  profileRefreshDays: { key: "PROFILE_REFRESH_DAYS", fallback: 90 },
  maximumFetchAttempts: { key: "PIPELINE_MAX_FETCH_ATTEMPTS", fallback: 3 },
  searchPagesPerPass: { key: "PIPELINE_SEARCH_PAGES_PER_PASS", fallback: 3 },
  passIntervalMs: { key: "PIPELINE_PASS_INTERVAL_MS", fallback: 60_000 },
  agentWakeIntervalMs: { key: "AGENT_WAKE_INTERVAL_MS", fallback: 15 * 60_000 },
  actionDelayMinMs: { key: "ACTION_DELAY_MIN_MS", fallback: 20_000 },
  actionDelayMaxMs: { key: "ACTION_DELAY_MAX_MS", fallback: 90_000 },
  workStartHour: { key: "WORK_START_HOUR", fallback: 9 },
  workEndHour: { key: "WORK_END_HOUR", fallback: 18 },
} as const;

/**
 * The shortest pause allowed between two LinkedIn actions, whatever `.env`
 * says, so a typo cannot turn the worker into a burst of requests.
 */
export const HARD_MINIMUM_ACTION_DELAY_MS = 5_000;

/**
 * The shortest gap allowed between two invites from one account, however the
 * day's share works out, so invites never go out in a burst.
 */
export const HARD_MINIMUM_INVITE_GAP_MS = 90_000;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Bounds of the random factor applied to the even spacing between invites,
 * so the gaps vary like a person's instead of ticking like a clock.
 */
const INVITE_GAP_JITTER = { minimum: 0.6, maximum: 1.4 } as const;

/**
 * How long to wait after the account's last invite before the next one.
 *
 * The day's share of invites is spread evenly over working hours, then the
 * gap is varied at random and never drops below the hard minimum.
 */
export function inviteGapMs(config: PipelineConfig, dailyShare: number): number {
  const workingMs = Math.max(0, config.workEndHour - config.workStartHour) * MS_PER_HOUR;
  const evenSpacing = workingMs / Math.max(1, dailyShare);
  const jitter = INVITE_GAP_JITTER.minimum + Math.random() * (INVITE_GAP_JITTER.maximum - INVITE_GAP_JITTER.minimum);
  return Math.max(HARD_MINIMUM_INVITE_GAP_MS, evenSpacing * jitter);
}

const WORK_TIMEZONE_KEY = "WORK_TIMEZONE";
const DEFAULT_WORK_TIMEZONE = "America/Sao_Paulo";
const WORK_DAYS_KEY = "WORK_DAYS";
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

/** Read the pipeline settings, using defaults for anything missing or invalid. */
export function loadPipelineConfig(environment: NodeJS.ProcessEnv = process.env): PipelineConfig {
  /** One whole-number setting, at least `minimum`. */
  const whole = (name: keyof typeof SETTINGS, minimum: number = CONFIG_NUMBER_MINIMUMS.positive, maximum?: number) =>
    resolveConfigNumber(environment[SETTINGS[name].key], {
      fallback: SETTINGS[name].fallback,
      minimum,
      ...(maximum === undefined ? {} : { maximum }),
      integer: true,
    });

  const delayMin = Math.max(HARD_MINIMUM_ACTION_DELAY_MS, whole("actionDelayMinMs", CONFIG_NUMBER_MINIMUMS.nonNegative));
  const delayMax = Math.max(delayMin, whole("actionDelayMaxMs", CONFIG_NUMBER_MINIMUMS.nonNegative));

  return {
    evaluationBatchSize: whole("evaluationBatchSize"),
    profileRefreshDays: whole("profileRefreshDays"),
    maximumFetchAttempts: whole("maximumFetchAttempts"),
    searchPagesPerPass: whole("searchPagesPerPass"),
    passIntervalMs: whole("passIntervalMs"),
    agentWakeIntervalMs: whole("agentWakeIntervalMs"),
    actionDelayMinMs: delayMin,
    actionDelayMaxMs: delayMax,
    workTimezone: environment[WORK_TIMEZONE_KEY]?.trim() || DEFAULT_WORK_TIMEZONE,
    workStartHour: whole("workStartHour", CONFIG_NUMBER_MINIMUMS.nonNegative, HOURS_PER_DAY),
    workEndHour: whole("workEndHour", CONFIG_NUMBER_MINIMUMS.nonNegative, HOURS_PER_DAY),
    workDays: workDays(environment[WORK_DAYS_KEY]),
  };
}

/**
 * Whether `now` falls inside working time in the configured timezone.
 *
 * Accounts are run like a person would use them: on working days, during
 * working hours, in the accounts' own timezone rather than the server's.
 */
export function isWorkingTime(now: Date, config: PipelineConfig): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.workTimezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = WEEKDAYS.indexOf(parts.find((part) => part.type === "weekday")?.value ?? "") + 1;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return config.workDays.includes(weekday) && hour >= config.workStartHour && hour < config.workEndHour;
}

/** A random pause length between the configured bounds. */
export function randomActionDelayMs(config: PipelineConfig): number {
  return config.actionDelayMinMs + Math.random() * (config.actionDelayMaxMs - config.actionDelayMinMs);
}

/** Short weekday names in ISO order, as `Intl` writes them in English. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Parse `1,2,3,4,5`, keeping only valid ISO weekdays; empty or invalid gives the default. */
function workDays(value: string | undefined): number[] {
  const days = (value ?? "")
    .split(",")
    .map((day) => Number(day.trim()))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= DAYS_PER_WEEK);
  return days.length ? [...new Set(days)] : DEFAULT_WORK_DAYS;
}
