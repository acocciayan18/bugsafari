# Database & Migrations
 
Use this for anything touching schema design, queries, or migrations, regardless of which database engine or ORM is in use — the principles below transfer across relational and (with adjustment) document stores.
 
## Schema design
 
- Model the domain, not the current UI — a schema that mirrors today's screen layout tends to need painful migrations the first time the UI changes. Normalize around what the data actually *is* and how it relates, then denormalize deliberately for a specific, known performance reason.
- Choose types deliberately: use proper date/time types (with timezone awareness where relevant) rather than strings, use enums or lookup tables for constrained sets of values rather than free-text, and pick numeric types based on actual required precision and range (e.g., use a decimal/numeric type for money, never floating point).
- Constraints belong in the database when they represent invariants that must always hold (foreign keys, uniqueness, not-null, check constraints) — don't rely solely on application-level validation for things that would corrupt data if bypassed by a different code path, a script, or direct DB access.
- Index based on actual query patterns (what's filtered on, joined on, sorted by) — not speculatively on every column. Over-indexing slows down writes and bloats storage for no benefit if the index is never used by the query planner.
## Avoiding common performance traps
 
- **N+1 queries**: fetching a list and then querying per-item in a loop instead of a single joined/batched query. This is one of the most common full-stack performance bugs and often invisible until data volume grows — check for it whenever iterating over a fetched collection and querying again inside the loop.
- **Unbounded queries**: any query returning a list should have pagination or a reasonable limit; "fetch all rows" works fine in dev with 20 rows and falls over in prod with 2 million.
- **Missing indexes on foreign keys and frequently filtered/sorted columns** — worth checking explicitly on any new query, not just assuming the ORM handles it.
- **Transactions that hold locks too long** — keep transactions scoped to the minimum necessary work; avoid doing slow I/O (network calls, sending emails) inside a DB transaction.
## Writing migrations safely
 
- Migrations should be reversible where practical — write the down/rollback path, not just the up path, even if you don't expect to use it.
- For any migration touching a table with real production data, think through: does this lock the table for a long time? Can this run online, or does it need a maintenance window? For large tables, prefer additive, backward-compatible steps (add a nullable column, backfill in batches, then add the constraint) over a single blocking `ALTER` that rewrites the whole table.
- Sequence schema changes to stay backward-compatible with the currently-deployed application code during a rolling deploy: e.g., don't drop a column in the same migration that stops the old code from reading it if there's any window where both versions run simultaneously.
- Never edit a migration that has already been applied in a shared environment (staging/prod) — write a new migration to correct it, since editing history breaks anyone who already ran the old version.
- Backfills for existing rows should run in batches with some throttling for large tables, not as a single unbounded `UPDATE`, to avoid long locks or replication lag.
## Data integrity during application changes
 
- When changing what a field means or how it's used, consider what existing rows currently hold under the old assumption, and whether they need a backfill or a compatibility shim.
- When removing a field or table, verify nothing else (reports, background jobs, other services) still reads it before dropping it — a search across the codebase is cheap insurance against breaking something a feature branch doesn't touch.
 