import { useCallback, useEffect, useRef, useState } from "react";

/** Key → default string value mapping. All filter values are strings in the URL. */
export type FilterDefaults = Record<string, string>;

export interface UseListFiltersReturn {
  values: FilterDefaults;
  /** Update a single filter key. Pass the default value (or "") to clear it. */
  set: (key: string, value: string) => void;
  /** Reset all filters to their defaults and clear the URL params. */
  reset: () => void;
  /** Number of filters currently set to a non-default, non-empty value. */
  activeCount: number;
}

/**
 * Manages a set of URL-synced filter params for list pages.
 *
 * - Reads initial values from the current URL search params (falling back to defaults).
 * - Writes changes back via `window.history.replaceState` on every state change so
 *   filters are bookmarkable and survive a browser refresh.
 * - `reset()` restores all values to their defaults and removes their URL params.
 *
 * Example usage:
 * ```ts
 * const { values, set, reset, activeCount } = useListFilters({
 *   status: "all",
 *   search: "",
 *   from: "",
 *   to: "",
 * });
 * const [search, setSearch] = [values.search, (v: string) => set("search", v)];
 * ```
 */
export function useListFilters(defaults: FilterDefaults): UseListFiltersReturn {
  const keys = Object.keys(defaults);
  const defaultsRef = useRef(defaults);

  const [values, setValues] = useState<FilterDefaults>(() => {
    const params = new URLSearchParams(window.location.search);
    const init: FilterDefaults = {};
    for (const key of keys) {
      const v = params.get(key);
      init[key] = v !== null && v !== "" ? v : defaults[key];
    }
    return init;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const def = defaultsRef.current;
    for (const key of keys) {
      const val = values[key] ?? "";
      const dflt = def[key] ?? "";
      if (val && val !== dflt) {
        params.set(key, val);
      } else {
        params.delete(key);
      }
    }
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
    // keys is derived from defaults object keys — stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const set = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setValues({ ...defaultsRef.current });
  }, []);

  const activeCount = keys.filter((k) => {
    const val = values[k] ?? "";
    const dflt = defaultsRef.current[k] ?? "";
    return val !== "" && val !== dflt;
  }).length;

  return { values, set, reset, activeCount };
}
