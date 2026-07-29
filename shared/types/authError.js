// ═══════════════════════════════════════════════════════════════
// shared/types/authError.ts — OPERATOR AUTH ERROR CONTRACT
// ═══════════════════════════════════════════════════════════════
// Machine-readable failure contract for BugSafari's own operator auth routes
// (login / signup / password reset / refresh) — unrelated to target-app auth
// in ./auth.ts.
//
// INVARIANT: `code` is the ONLY field the dashboard branches on. `error` is a
// short server-authored string kept for logs and non-UI clients; the operator
// copy is derived from `code` on the frontend so wording stays consistent and
// no internal detail (stack, driver text, enumeration signal) can leak into a
// toast or alert.
export {};
