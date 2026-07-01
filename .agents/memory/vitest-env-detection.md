---
name: Detecting vitest in runtime code
description: How to guard code that must not run during vitest test runs, when NODE_ENV is inherited from the container environment.
---

# Detecting vitest in runtime code

## The rule
Use `!process.env.VITEST` (not `process.env.NODE_ENV !== "test"`) to detect when code is running inside a vitest process.

**Why:** The Replit container sets `NODE_ENV=development` at the OS environment level. Vitest inherits this and does NOT override it (vitest only sets `NODE_ENV=test` if it is not already set). So `process.env.NODE_ENV` is `"development"` inside vitest runs in this project. Vitest always sets `process.env.VITEST` (to `"true"`) regardless of what `NODE_ENV` is.

**How to apply:** Any dev-only bypass or mock block in route/server code that must be inert during tests should be guarded with:
```typescript
if (process.env.SOME_DEV_FLAG === "true" && !process.env.VITEST) {
  // dev-only mock routes / bypasses
}
```

This pattern is used for the `SHOPIFY_DEV_MOCK` block in `artifacts/api-server/src/routes/shopify.ts`.
