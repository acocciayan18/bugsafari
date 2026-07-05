# Testing Strategy
 
Use this when writing tests, or when a feature/bugfix should ship with tests. The goal of a test is to catch a real regression later, not to produce a coverage number — write with that in mind.
 
## Choosing the right layer
 
- **Unit tests** — pure logic, business rules, edge-case handling in a single function/class, with dependencies mocked or stubbed. Fast, cheap, should be the bulk of the suite. Good for: validation logic, calculations, state transitions, pure data transformations.
- **Integration tests** — a slice of the real stack working together (e.g., an API endpoint hitting a real test database). Good for: verifying the contract between layers actually holds — that the ORM query really returns what the handler expects, that a migration didn't silently break a query.
- **End-to-end tests** — a real user flow through the full system (often via a browser or full HTTP client). Expensive and slower, so reserve for the handful of flows where a break would be a genuine catastrophe (checkout, login, core conversion path) rather than trying to E2E-test everything.
A rough default: many unit tests, a meaningful but smaller set of integration tests around real boundaries (DB, external API, auth), and a few E2E tests around the flows that matter most to the business.
 
## What's actually worth testing
 
- The bug you just fixed — add a regression test that would have caught it, not just a test that happens to pass with the fix applied.
- Boundary and edge conditions: empty input, maximum size, zero, negative numbers, unicode/special characters in strings, concurrent access to shared state, the first/last item in a collection.
- Failure paths: what happens when a dependency times out, returns malformed data, or is simply down — not just the happy path.
- Business rules with real consequences (pricing, permissions, anything financial or safety-related) deserve more thorough coverage than internal tooling.
Skip testing framework internals, trivial getters/setters, or third-party library behavior you don't control — that's not where regressions come from.
 
## Writing tests that stay useful
 
- Name tests by behavior, not implementation: `rejects_withdrawal_when_balance_insufficient` tells you what broke when it fails; `test_withdraw_2` doesn't.
- Keep tests independent — one test's failure or state shouldn't cascade into unrelated test failures, and tests shouldn't depend on execution order.
- Mock external boundaries (network calls, time, randomness, filesystem) so tests are deterministic and fast, but avoid over-mocking internal collaborators to the point that the test just re-describes the implementation and breaks on every refactor even when behavior is unchanged.
- Assert on outcomes and observable behavior, not incidental implementation details (e.g., prefer asserting the returned value or the resulting DB state over asserting that a specific private method was called, unless the call itself is the thing being tested).
## Before calling a change "tested"
 
- Does the new test actually fail if you revert the fix/feature? (Worth mentally checking — a test that passes regardless of the change under test isn't testing anything.)
- Did you check for regressions in adjacent behavior, not just the new path — does the existing suite still pass, and did you add coverage for other callers of anything you changed?
- For anything touching concurrency, timing, or async flows: did you think through race conditions rather than just testing the sequential-looking case?
 