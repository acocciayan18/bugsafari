// Minimal zero-dependency test runner: discovers every *.test.ts under src/ and
// runs it through the already-present `tsx` loader. Each test file is a
// self-executing script that exits non-zero on the first failed assertion
// (node:assert), so we aggregate child exit codes. Keeps the project free of an
// external test framework per the "no external libraries" constraint.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../src', import.meta.url));

// Recursively collect *.test.ts, skipping build/vendor dirs.
function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findTests(full));
    } else if (entry.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

const files = findTests(rootDir).sort();
if (files.length === 0) {
  console.log('No *.test.ts files found under src/.');
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const rel = file.slice(rootDir.length + 1);
  console.log(`\n▶ ${rel}`);
  // shell:true so `tsx` resolves via node_modules/.bin on both PowerShell and sh;
  // the path is quoted so a repo directory containing spaces still resolves.
  const result = spawnSync('npx', ['tsx', `"${file}"`], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    failed += 1;
    console.error(`✗ FAILED: ${rel}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} test file(s) passed.`);
process.exit(failed > 0 ? 1 : 0);
