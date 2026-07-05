# API Design
 
Use this when designing or extending an API surface, whether REST, GraphQL, or RPC-style — adapt the specifics to whichever style the codebase already uses.
 
## Consistency with what already exists
 
Before adding a new endpoint or field, look at how existing ones in the same codebase handle: resource naming, error shape, pagination, auth, and versioning. A new endpoint that's individually "more correct" by some external standard but inconsistent with its neighbors makes the API harder to use as a whole — match the existing convention unless there's a real reason to introduce a new one (and if so, flag that you're doing it).
 
## REST conventions (when that's the style in use)
 
- Resource-oriented URLs (`/orders/123/items`) rather than verb-oriented (`/getOrderItems?id=123`); use HTTP methods for the verbs (GET/POST/PUT/PATCH/DELETE).
- Use status codes meaningfully: 2xx for success (200 vs 201 vs 204 as appropriate), 4xx for client errors (400 validation, 401 unauthenticated, 403 unauthorized, 404 not found, 409 conflict, 422 unprocessable), 5xx reserved for actual server-side failures — don't return 200 with an error payload buried inside, since that breaks generic client/monitoring error handling.
- PATCH for partial updates, PUT for full replacement, if the codebase distinguishes them — be consistent about which one is used where.
## Error responses
 
Return a consistent, structured error shape across the whole API rather than ad hoc strings per endpoint, something like:
 
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary",
    "details": [{"field": "email", "issue": "must be a valid email address"}]
  }
}
```
 
The `code` should be stable and machine-checkable (clients may branch on it); the `message` is for humans/logs and can change wording without breaking anything. Never leak stack traces, internal file paths, or raw database errors into a response body in production.
 
## Pagination
 
- Any endpoint returning a list that can grow unbounded needs pagination from day one — retrofitting it later is a breaking change for every existing consumer.
- Cursor-based pagination is generally more robust than offset-based for data that changes while being paged through (avoids skipped/duplicated rows), but offset-based is simpler and fine for smaller, relatively static datasets.
- Include enough metadata for the client to know whether more pages exist (a `next_cursor`/`has_more` field, or a total count if cheap to compute) rather than making the client guess from page size.
## Versioning & backward compatibility
 
- Additive changes (new optional field, new endpoint) generally don't need a version bump. Anything that changes the meaning or removes a field an existing consumer might rely on does.
- Prefer expanding a contract (add fields, keep old ones working) over changing it in place when there are existing consumers you don't control — this is especially true for public/partner-facing APIs where you can't coordinate a synchronized deploy.
- If a genuine breaking change is needed, think through how consumers migrate: a deprecation window with both old and new behavior available, clear communication of the cutover date, and a sunset plan — rather than a silent behavior change on an existing endpoint.
## Auth on API endpoints
 
- Every endpoint should have an explicit, deliberate auth decision — "public," "authenticated," or "authenticated + specific permission" — not an accidental default. New endpoints copied from an existing one sometimes inherit auth they weren't meant to (or forget it entirely).
- Authorization checks belong server-side per resource (see `security-checklist.md` for the IDOR pattern) — an authenticated request is not the same as an authorized one.