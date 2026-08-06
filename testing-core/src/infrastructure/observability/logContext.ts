// Per-request log context carried via AsyncLocalStorage. Kept dependency-free and
// separate from the logger/middleware so both can read it without an import cycle.
// Distinct from the seeded-PRNG ALS in SafariWorker — these two never overlap.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  reqId?: string;
  userId?: string;
  runCode?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

// Read the active context, or an empty object when running outside any request.
export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

// Run a function with a bound context; nested calls inherit unless overridden.
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

// Merge fields into the active context in place (e.g. attach userId after auth).
export function assignLogContext(fields: LogContext): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}
