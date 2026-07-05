# Architecture & Planning
 
Use this when a request involves a real design choice — a new feature of any size, a new service, a schema redesign, or anything where more than one reasonable approach exists.
 
## Sizing the thinking to the task
 
Not every task needs a design doc. A rough scale:
 
- **Trivial change** (fix a typo, adjust a style, tweak a constant): no planning needed, just do it.
- **Small feature** (add a field, add an endpoint that follows an existing pattern): a sentence or two on what layers it touches is enough.
- **Real feature** (new user-facing capability, new integration, anything touching auth or money or shared state): walk through the data → backend → API → frontend chain explicitly, and name the trade-offs you're making.
- **Architectural decision** (new service boundary, choosing a data store, a breaking API change, introducing a new dependency that the whole team will live with): treat this as a decision worth writing down, even briefly — the "why" will matter to someone reading this in six months.
## Questions worth asking before designing
 
- What does this need to do today, and how likely is the "obvious next request" (the thing they'll ask for right after this ships)? Don't over-build for hypothetical futures, but don't paint into a corner on a near-certain one either.
- What already exists that does something similar? Reuse and extend before introducing a parallel mechanism.
- What's the failure mode if this component is slow, unavailable, or returns unexpected data? Who's affected, and how loud is the failure (silent data corruption is worse than a visible error).
- Who else calls into this code path, and what do they assume about its current behavior?
## Documenting a decision (when it's worth documenting)
 
Keep it short — a paragraph, not a template to fill in:
 
```
Decision: [what was chosen]
Why: [the actual deciding factor — not a list of pros/cons, the thing that tipped it]
Trade-off accepted: [what this costs, so it's not a surprise later]
```
 
Example:
```
Decision: Store user preferences as a JSONB column rather than a separate
normalized table.
Why: preferences are read as a whole on every page load and never queried
by individual field; normalizing would add joins for no real benefit here.
Trade-off accepted: can't easily add a DB-level constraint on individual
preference values, or index on one. Fine given current usage; revisit if
we ever need to query "all users with preference X."
```
 
## Working across the stack coherently
 
When a feature spans layers, keep the contract between them explicit and consistent in both directions:
 
- The shape of data coming out of the database should map cleanly to what the API returns — extra transformation layers that just reshape data for no functional reason are a common source of subtle bugs and maintenance burden.
- If the frontend needs to know about a state that the backend doesn't currently expose (e.g., "is this the user's first login"), decide once where that state is computed and stored, rather than letting each layer infer it independently in slightly different ways.
- Naming should stay consistent end-to-end where practical — a field called `is_active` in the DB probably shouldn't become `enabled` in the API and `status` in the frontend. Renames should be deliberate, not incidental.
## Red flags worth surfacing to the user mid-design
 
- A "simple" feature that actually requires a new table, a migration, and a backfill — worth naming explicitly so the estimate/scope is accurate.
- A design that only works if a downstream system behaves a particular way that isn't guaranteed (e.g., assumes webhook delivery is exactly-once when the provider only guarantees at-least-once).
- Introducing a new external dependency (library, service, data store) for something the existing stack could already do reasonably well — worth a one-line "do we need this, or does X already cover it?"
 