---
name: Shopify webhook async queue
description: Webhook handler returns 200 immediately; processWebhookTopic is exported from shopifyWebhook.ts and wired into the worker via index.ts to avoid circular imports.
---

## The pattern

- `routes/shopifyWebhook.ts`: route does HMAC + dedup + `enqueueWebhookJob()` + `res.json({ok:true})`; exports `processWebhookTopic(orgId, topic, body)` as a named export (not called from the route)
- `lib/shopifyWebhookQueue.ts`: queue module — `enqueueWebhookJob`, `startWebhookWorker(processFn)`, retry logic; does NOT import from shopifyWebhook (avoids circular dep)
- `index.ts`: calls `startWebhookWorker(processWebhookTopic)` — this is the wiring point
- `lib/db/src/schema/shopifyWebhookJobs.ts`: the queue table

**Why:** All webhook processing was synchronous — triggered ~63% Shopify delivery failures by exceeding the 5-second timeout.

**How to apply:** Any future webhook topic additions go into the `processWebhookTopic` switch in `shopifyWebhook.ts`. The queue + worker plumbing is transparent.
