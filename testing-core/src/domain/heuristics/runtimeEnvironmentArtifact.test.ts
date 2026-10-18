// Standalone deterministic test for WebAuthn / automation-environment artifact suppression.
// Run with `npx tsx src/domain/heuristics/runtimeEnvironmentArtifact.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { isEnvironmentArtifactError } from './RuntimeStabilityFinder.js';
import { isIgnorableConsoleError } from '../services/telemetry/StabilityMonitor.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function main(): void {
  console.log('runtimeEnvironmentArtifact — WebAuthn/automation suppression');

  check('the fb.com WebAuthn message is an environment artifact', () => {
    assert.equal(isEnvironmentArtifactError('The user agent does not support public key credentials.'), true);
  });

  check('matches across casing and related capability-absent signatures', () => {
    assert.equal(isEnvironmentArtifactError('DOES NOT SUPPORT PUBLIC KEY CREDENTIALS'), true);
    assert.equal(isEnvironmentArtifactError('PublicKeyCredential is not defined'), true);
    assert.equal(isEnvironmentArtifactError('navigator.credentials is undefined'), true);
    assert.equal(isEnvironmentArtifactError('WebAuthn is not supported in this browser'), true);
    assert.equal(isEnvironmentArtifactError('navigator.webdriver is true'), true);
  });

  // Regression: a genuine app runtime bug must NOT be swallowed.
  check('a real TypeError is NOT an environment artifact', () => {
    assert.equal(isEnvironmentArtifactError("Cannot read properties of undefined (reading 'id')"), false);
  });

  // Regression: genuine credential/WebAuthn BUSINESS errors stay findings (absence phrasing required).
  check('genuine credential/WebAuthn business errors are NOT swallowed', () => {
    assert.equal(isEnvironmentArtifactError('Login failed: invalid credentials'), false);
    assert.equal(isEnvironmentArtifactError('WebAuthn registration failed: user not found'), false);
  });

  // The console channel routes through isIgnorableConsoleError — confirm the wiring.
  check('console channel ignores the WebAuthn error but keeps a real exception', () => {
    assert.equal(isIgnorableConsoleError('The user agent does not support public key credentials.'), true);
    assert.equal(isIgnorableConsoleError("Uncaught TypeError: Cannot read properties of null (reading 'value')"), false);
  });

  console.log(`\nruntimeEnvironmentArtifact: ${passed} checks passed.`);
}

main();
