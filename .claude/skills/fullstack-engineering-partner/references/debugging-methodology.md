# Debugging Methodology
 
Use this whenever the user brings a bug, an unexpected behavior, or an error message. The goal is a fix that addresses why the failure happens, not just one that makes the reported symptom disappear.
 
## The process
 
1. **Establish the actual failure**, not the assumed one. Read the full error/stack trace, not just the first line — the root cause is often several frames away from where the error surfaced. If given a vague description ("it's broken"), ask for or look for the specific symptom: error message, expected vs. actual behavior, when it started happening.
2. **Reproduce or trace the exact path.** If you can run the code, reproduce it. If you can't, trace through the logic by hand with the specific input that triggers it, rather than pattern-matching to "this looks like a bug I've seen before" — superficially similar bugs often have different causes.
3. **Ask "why" past the first answer.** The immediate cause ("this variable was null") is rarely the root cause ("this function was called before the async initialization completed, because a new call site skipped the setup step"). Fixing at the immediate-cause layer often just moves the bug to the next caller that makes the same mistake.
4. **Check whether this is symptomatic of a class of bug**, not a one-off. If a null check is missing here, is the same pattern missing elsewhere in the codebase? Worth a quick grep rather than only patching the one spot the user noticed.
5. **Propose the fix, then verify it doesn't break something else.** Who else calls this function? Does changing this validation rule reject previously-valid input? Does this fix rely on an assumption that's true today but fragile?
## Common root-cause categories worth checking
 
- **Race conditions / ordering assumptions** — code assumes A finishes before B, but nothing enforces that; works in dev (fast/single-threaded-feeling), fails intermittently in production.
- **Off-by-one / boundary errors** — inclusive vs. exclusive ranges, empty collections, the first/last element, zero-indexed vs one-indexed mismatches between layers.
- **Stale state or caching** — a cache, memoized value, or client-side state that isn't invalidated when the underlying data changes.
- **Incorrect assumptions about external systems** — assuming an API is synchronous when it's eventually consistent, assuming exactly-once delivery when a queue/webhook only guarantees at-least-once, assuming a third-party response schema that occasionally varies.
- **Type coercion / implicit conversion** — especially in loosely-typed languages, where a comparison or arithmetic operation silently does something other than what was intended.
- **Environment/config drift** — works locally, breaks in staging/prod, because of a config difference, missing environment variable, or version mismatch rather than a code bug at all.
- **Mutation of shared state** — a function mutates an object it was passed rather than returning a new one, and a caller elsewhere in the codebase depended on the original being unchanged.
## When you can't fully diagnose it yet
 
Say so plainly rather than guessing and presenting a guess as a confident diagnosis. State what you've ruled in/out, and what specific piece of information (a log line, a reproduction step, a data sample) would let you narrow it further. A precise "here's what I'd need to confirm this" is more useful than a fix that might not address the actual cause.
 
## After the fix
 
Briefly note what you verified: that the reported case now works, that you checked other call sites of the changed code, and — if you added a regression test — that it fails without the fix and passes with it.
 