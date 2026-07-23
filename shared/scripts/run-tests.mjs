// Zero-dependency test runner for the shared contract layer. Mirrors the
// testing-core runner: discovers every *.test.ts under shared/ and runs it through
// the `tsx` loader (resolved from the workspace root). Each test file self-executes
// and exits non-zero on the first failed node:assert, so we aggregate exit codes.
// Keeps shared free of an external test framework per the "no external libraries" rule.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'scripts') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findTests(full));
    else if (entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

const files = findTests(rootDir).sort();
if (files.length === 0) {
  console.log('No *.test.ts files found under shared/.');
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const rel = file.slice(rootDir.length + 1);
  console.log(`\n ${rel}`);
  const result = spawnSync('npx', ['tsx', `"${file}"`], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    failed += 1;
    console.error(`✗ FAILED: ${rel}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} shared test file(s) passed.`);
process.exit(failed > 0 ? 1 : 0);
