import { QueryClient, QueryCache } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";

function emitForbidden() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("api:forbidden"));
  }
}

function emitUnauthenticated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("api:unauthenticated"));
  }
}

function is403(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 403;
  // Fallback for any error-like objects that carry a numeric status
  // (e.g. plain Error subclasses thrown by raw fetch helpers).
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" && status === 403;
}

function is401(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 401;
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" && status === 401;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      if (is403(error)) emitForbidden();
      if (is401(error)) emitUnauthenticated();
    },
  }),
  defaultOptions: {
    queries: {
      retry: false,
      // 30 s default stale time — navigating back to a recently-visited
      // list shows cached data immediately without triggering a refetch
      // unless it's more than 30 seconds old.
      staleTime: 30_000,
      // Refetch when the user re-focuses the tab or reconnects,
      // but only if the data is stale.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Only refetch on mount if data is actually stale (respects staleTime).
      // Previously "always" — caused unnecessary refetches on every navigation.
      refetchOnMount: true,
      // Keep cached data around for 10 minutes after a query is unused
      // so back/forward navigation feels instant.
      gcTime: 10 * 60_000,
    },
  },
});

// Longer stale times for reference data that changes infrequently.
// Use these in individual query hooks: useQuery({ ...opts, staleTime: STALE_REFERENCE })
export const STALE_REFERENCE = 5 * 60_000; // 5 min — warehouses, customers, suppliers
export const STALE_LIST = 30_000;           // 30 s — paginated lists
export const STALE_DETAIL = 60_000;        // 60 s — individual record details
