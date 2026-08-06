// Zero-dependency structured logger. Prod emits one JSON line per event; dev emits
// a readable tagged line. Secrets are redacted at the boundary and the active
// request context (reqId/userId/runCode) is folded into every record. Methods are
// console-compatible (variadic) so existing call sites migrate by a plain rename.

import { redactSecrets } from '../database/logSanitizer.js';
import { getLogContext } from './logContext.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const isProduction = process.env.NODE_ENV === 'production';

// Field keys whose values are dropped wholesale — never logged, even redacted.
const SECRET_KEY = /^(password|passwd|pwd|secret|token|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|jwt|cookie)$/i;

const MAX_MESSAGE_LEN = 4000;

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return isProduction ? 'info' : 'debug';
}

const activeLevel = resolveLevel();

// Redact a message string and clamp its length so a hostile payload can't flood logs.
function cleanMessage(message: string): string {
  const redacted = redactSecrets(message);
  return redacted.length > MAX_MESSAGE_LEN ? `${redacted.slice(0, MAX_MESSAGE_LEN)}…` : redacted;
}

// Serialize an Error into a plain, redacted, JSON-safe shape.
function serializeError(err: Error): LogFields {
  return { name: err.name, message: cleanMessage(err.message), stack: err.stack ? cleanMessage(err.stack) : undefined };
}

// Coerce an arbitrary log argument into something JSON-safe and redacted.
function serializeArg(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === 'string') return redactSecrets(value);
  return value;
}

// A plain data object usable directly as structured fields (not an Error/array).
function isPlainFields(value: unknown): value is LogFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Error);
}

// Redact field values by key and content.
function cleanFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SECRET_KEY.test(key)) { out[key] = '[REDACTED]'; continue; }
    out[key] = serializeArg(value);
  }
  return out;
}

// Turn console-style variadic args into a message plus optional structured fields.
function normalize(args: unknown[]): { message: string; fields?: LogFields } {
  const [first, ...rest] = args;
  const message = typeof first === 'string' ? first : safeStringify(first);
  if (rest.length === 0) return { message };
  if (rest.length === 1 && rest[0] instanceof Error) return { message, fields: cleanFields({ err: rest[0] }) };
  if (rest.length === 1 && isPlainFields(rest[0])) return { message, fields: cleanFields(rest[0]) };
  return { message, fields: { args: rest.map(serializeArg) } };
}

function safeStringify(value: unknown): string {
  try { return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value); }
  catch { return String(value); }
}

function emit(level: LogLevel, component: string, args: unknown[]): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[activeLevel]) return;

  const context = getLogContext();
  const { message, fields } = normalize(args);
  // Drop a redundant leading tag when it exactly repeats the component (migrated
  // call sites kept their inline prefix); a differing inline tag is left intact.
  const deduped = message.startsWith(`${component} `) ? message.slice(component.length + 1) : message;
  const cleanMsg = cleanMessage(deduped);

  if (isProduction) {
    const record = { ts: new Date().toISOString(), level, component, msg: cleanMsg, ...context, ...fields };
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }

  const ctx = context.reqId ? ` (${context.reqId})` : '';
  const tail = fields && Object.keys(fields).length > 0 ? ` ${safeStringify(fields)}` : '';
  const line = `[${level}] ${component}${ctx} ${cleanMsg}${tail}`;
  const sink = level === 'error' ? process.stderr : process.stdout;
  sink.write(`${line}\n`);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(subComponent: string): Logger;
}

// Build a logger bound to a component tag (e.g. '[BugSafari]'), preserving the
// existing prefix convention as the structured `component` field.
export function createLogger(component: string): Logger {
  return {
    debug: (...args) => emit('debug', component, args),
    info: (...args) => emit('info', component, args),
    warn: (...args) => emit('warn', component, args),
    error: (...args) => emit('error', component, args),
    child: (subComponent) => createLogger(`${component}${subComponent}`),
  };
}
