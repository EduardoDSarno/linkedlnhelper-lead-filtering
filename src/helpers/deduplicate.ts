/** The result of removing duplicate items from a list. */
export interface DeduplicationResult<T> {
  uniqueItems: T[];
  duplicateCount: number;
}

/**
 * Keeps the first item for each key and counts later items with the same key.
 *
 * `T` is the type of item in the list. `Key` is the type returned by getKey.
 * A key selector lets this work with both primitive values and objects.
 */
export function deduplicateBy<T, Key extends PropertyKey>(
  items: readonly T[],
  getKey: (item: T) => Key,
): DeduplicationResult<T> {
  const seenKeys = new Set<Key>();
  const uniqueItems: T[] = [];
  let duplicateCount = 0;

  for (const item of items) {
    const key = getKey(item);

    if (seenKeys.has(key)) {
      duplicateCount++;
      continue;
    }

    seenKeys.add(key);
    uniqueItems.push(item);
  }

  return {
    uniqueItems,
    duplicateCount,
  };
}
