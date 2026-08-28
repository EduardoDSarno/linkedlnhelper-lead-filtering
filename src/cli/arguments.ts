/** Supported execution modes exposed by the current terminal entry point. */
export const APPLICATION_MODE = {
  importCsv: 'import_csv',
  collectProfiles: 'collect_profiles',
  reviewProfiles: 'review_profiles',
} as const;

/** Command flags selecting work beyond a CSV-only import. */
export const APPLICATION_MODE_FLAG = {
  collect: '--collect',
  collectApify: '--collect-apify',
  review: '--review',
} as const;

/** Human-readable invocation examples reported for invalid arguments. */
export const APPLICATION_USAGE = {
  importCsv: 'npm start -- <path-to-csv>',
  collectProfiles: 'npm run collect -- <path-to-csv>',
  reviewProfiles: 'npm run review -- <path-to-csv> <path-to-criteria-json>',
} as const;

/** Parsed arguments for a CSV-only import. */
export interface CsvImportArguments {
  mode: typeof APPLICATION_MODE.importCsv;
  csvPath: string;
}

/** Parsed arguments for provider collection without profile evaluation. */
export interface ProfileCollectionArguments {
  mode: typeof APPLICATION_MODE.collectProfiles;
  csvPath: string;
}

/** Parsed arguments for the complete acquisition and evaluation workflow. */
export interface ReviewInputArguments {
  mode: typeof APPLICATION_MODE.reviewProfiles;
  csvPath: string;
  criteriaPath: string;
}

/** Every valid argument shape accepted by the application. */
export type ApplicationArguments =
  | CsvImportArguments
  | ProfileCollectionArguments
  | ReviewInputArguments;

/** Identifies a command line that cannot safely select one application flow. */
export class ApplicationArgumentsError extends Error {
  /** Creates an argument validation failure for the terminal entry point. */
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationArgumentsError';
  }
}

/** Reports whether one argument is a recognized application mode flag. */
function isModeFlag(argument: string): boolean {
  return Object.values(APPLICATION_MODE_FLAG).includes(
    argument as (typeof APPLICATION_MODE_FLAG)[keyof typeof APPLICATION_MODE_FLAG],
  );
}

/** Resolves the selected mode while rejecting conflicting command flags. */
function applicationMode(
  modeFlags: readonly string[],
): ApplicationArguments['mode'] {
  if (modeFlags.length > 1) {
    throw new ApplicationArgumentsError(
      'Choose only one collection or review mode.',
    );
  }

  const flag = modeFlags[0];
  if (flag === APPLICATION_MODE_FLAG.review) {
    return APPLICATION_MODE.reviewProfiles;
  }
  if (
    flag === APPLICATION_MODE_FLAG.collect ||
    flag === APPLICATION_MODE_FLAG.collectApify
  ) {
    return APPLICATION_MODE.collectProfiles;
  }
  return APPLICATION_MODE.importCsv;
}

/** Parses and validates paths before the application opens any input files. */
export function parseApplicationArguments(
  arguments_: readonly string[],
): ApplicationArguments {
  const unknownFlags = arguments_.filter(
    (argument) => argument.startsWith('--') && !isModeFlag(argument),
  );
  if (unknownFlags.length > 0) {
    throw new ApplicationArgumentsError(
      `Unsupported command flags: ${unknownFlags.join(', ')}.`,
    );
  }

  const modeFlags = arguments_.filter(isModeFlag);
  const positionalArguments = arguments_.filter(
    (argument) => !isModeFlag(argument),
  );
  const mode = applicationMode(modeFlags);

  if (mode === APPLICATION_MODE.reviewProfiles) {
    const [csvPath, criteriaPath, ...unexpected] = positionalArguments;
    if (!csvPath || !criteriaPath || unexpected.length > 0) {
      throw new ApplicationArgumentsError(
        `Review mode requires exactly two paths: ${APPLICATION_USAGE.reviewProfiles}.`,
      );
    }
    return { mode, csvPath, criteriaPath };
  }

  const [csvPath, ...unexpected] = positionalArguments;
  if (!csvPath || unexpected.length > 0) {
    const usage =
      mode === APPLICATION_MODE.collectProfiles
        ? APPLICATION_USAGE.collectProfiles
        : APPLICATION_USAGE.importCsv;
    throw new ApplicationArgumentsError(
      `This mode requires exactly one CSV path: ${usage}.`,
    );
  }

  return { mode, csvPath };
}
