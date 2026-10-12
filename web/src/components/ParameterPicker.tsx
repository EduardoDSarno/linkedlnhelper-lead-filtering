import { useEffect, useState } from "react";

import { api } from "../api";
import type { SearchParameter } from "../api";

/** Wait after the last keystroke before asking LinkedIn, so typing is not one request per letter. */
const LOOKUP_DELAY_MS = 300;

/**
 * Pick LinkedIn filter values (cities, industries, companies, schools) by name.
 *
 * LinkedIn's search filters take ids, not names, so each typed word is looked
 * up through the account and the chosen ids are kept with their titles for
 * the review page.
 */
export function ParameterPicker(props: {
  label: string;
  type: "LOCATION" | "INDUSTRY" | "COMPANY" | "SCHOOL";
  accountId: string;
  value: SearchParameter[];
  onChange(value: SearchParameter[]): void;
}) {
  const { label, type, accountId, value, onChange } = props;
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchParameter[]>([]);

  useEffect(() => {
    if (!accountId || !query.trim()) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ accountId, type, q: query });
      api<{ items: SearchParameter[] }>(`/api/search-parameters?${params}`)
        .then((answer) => setOptions(answer.items))
        .catch(() => setOptions([]));
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [accountId, type, query]);

  const chosenIds = new Set(value.map((item) => item.id));

  return (
    <div className="relative">
      <span className="text-sm font-medium">{label}</span>
      {value.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {value.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
              {item.title}
              <button type="button" onClick={() => onChange(value.filter((other) => other.id !== item.id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={query}
        disabled={!accountId}
        placeholder={accountId ? "Type to search…" : "Choose an account first"}
        onChange={(event) => setQuery(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
      />
      {options.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {options
            .filter((option) => !chosenIds.has(option.id))
            .map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, option]);
                    setQuery("");
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  {option.title}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
