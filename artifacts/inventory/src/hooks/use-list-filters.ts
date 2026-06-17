import { useMemo, useCallback, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useDebounce } from "./use-debounce";

/** Key → default string value mapping. All filter values are strings in the URL. */
export type FilterDefaults = Record<string, string>;

export interface UseListFiltersReturn {
  values: FilterDefaults;
  /** Update a single filter key. Pass the default value (or "") to clear it. */
  set: (key: string, value: string) => void;
  /** Atomically update multiple filter keys in a single navigation call. */
  setMany: (updates: Record<string, string>) => void;
  /** Reset all filters to their defaults and remove their URL params. */
  reset: () => void;
  /** Number of filters currently set to a non-default, non-empty value. */
  activeCount: number;
  /**
   * Debounced value of `values.search` (400 ms).
   * Pass this to API query functions instead of `values.search` directly.
   */
  debouncedSearch: string;
}

/**
 * Manages a set of URL-synced filter params for list pages.
 *
 * Uses wouter's `useSearch` / `useLocation` so the URL is the single source
 * of truth — the browser back-button and direct-link sharing work for free.
 *
 * Example usage:
 * ```ts
 * const { values, set, setMany, reset, activeCount, debouncedSearch } = useListFilters({
 *   search: "",
 *   status: "all",
 *   from: "",
 *   to: "",
 * });
 * ```
 */
export function useListFilters(defaults: FilterDefaults): UseListFiltersReturn {
  const defaultsRef = useRef(defaults);
  const rawSearch = useSearch();          // query string WITHOUT leading "?"
  const [currentPath, navigate] = useLocation();

  const values = useMemo(() => {
    const params = new URLSearchParams(rawSearch);
    const result: FilterDefaults = {};
    for (const key of Object.keys(defaultsRef.current)) {
      const v = params.get(key);
      result[key] = v !== null && v !== "" ? v : defaultsRef.current[key];
    }
    return result;
  }, [rawSearch]);

  const buildQs = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(rawSearch);
      const def = defaultsRef.current;
      for (const [key, value] of Object.entries(updates)) {
        const dflt = def[key] ?? "";
        if (value && value !== dflt) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      return params.toString();
    },
    [rawSearch],
  );

  const set = useCallback(
    (key: string, value: string) => {
      const qs = buildQs({ [key]: value });
      navigate(currentPath + (qs ? `?${qs}` : ""), { replace: true });
    },
    [buildQs, navigate, currentPath],
  );

  const setMany = useCallback(
    (updates: Record<string, string>) => {
      const qs = buildQs(updates);
      navigate(currentPath + (qs ? `?${qs}` : ""), { replace: true });
    },
    [buildQs, navigate, currentPath],
  );

  const reset = useCallback(() => {
    const params = new URLSearchParams(rawSearch);
    for (const key of Object.keys(defaultsRef.current)) {
      params.delete(key);
    }
    const qs = params.toString();
    navigate(currentPath + (qs ? `?${qs}` : ""), { replace: true });
  }, [rawSearch, navigate, currentPath]);

  const activeCount = useMemo(() => {
    return Object.keys(defaultsRef.current).filter((k) => {
      const val = values[k] ?? "";
      const dflt = defaultsRef.current[k] ?? "";
      return val !== "" && val !== dflt;
    }).length;
  }, [values]);

  const debouncedSearch = useDebounce(values.search ?? "", 400);

  return { values, set, setMany, reset, activeCount, debouncedSearch };
}
