// jsonPaths — flatten a JSON value (or a pre-built DOM map) into comparable path->value
// entries, and diff two such maps. Pure; reused by the volatility model and (later) the
// self-learned baseline schema inference.

const MAX_PATHS = 2000;
const MAX_VALUE_LEN = 512;
const MAX_DEPTH = 12;

// Flatten any JSON-serializable value to a path->value map. Arrays index by position;
// objects by key; primitives stringify. Bounded on breadth, depth, and value length.
export function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  walk(value, prefix, out, 0);
  return out;
}

function walk(value: unknown, path: string, out: Map<string, string>, depth: number): void {
  if (out.size >= MAX_PATHS) return;
  if (value === null || value === undefined) {
    set(out, path, String(value));
    return;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return set(out, path, '[array]');
    value.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`, out, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return set(out, path, '[object]');
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, out, depth + 1);
    }
    return;
  }
  set(out, path, String(value));
}

function set(out: Map<string, string>, path: string, value: string): void {
  if (out.size >= MAX_PATHS) return;
  out.set(path || '$', value.length > MAX_VALUE_LEN ? value.slice(0, MAX_VALUE_LEN) : value);
}

// Paths whose values differ (a path present on only one side counts as changed).
export function changedPaths(a: Map<string, string>, b: Map<string, string>): Set<string> {
  const changed = new Set<string>();
  for (const [path, av] of a) if (b.get(path) !== av) changed.add(path);
  for (const [path, bv] of b) if (a.get(path) !== bv) changed.add(path);
  return changed;
}
