// Live self-check for the Gemini remediation path: proves a configured key really
// generates, and that every failure mode classifies instead of silently falling back.
// Run: npx tsx scripts/gemini-selfcheck.ts   (needs GEMINI_API_KEY in .env)

import assert from 'node:assert/strict';
import dotenv from 'dotenv';

dotenv.config();

const MODULE = '../src/infrastructure/ai/GeminiRemediationAdvisor.js';
const REAL_KEY = process.env.GEMINI_API_KEY?.trim() ?? '';
const REAL_MODEL = process.env.GEMINI_MODEL?.trim() ?? '';

// Advisor reads env at import time, so each case needs a fresh module instance.
async function withEnv(id: string, env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import(`${MODULE}?case=${id}`) as Promise<typeof import('../src/infrastructure/ai/GeminiRemediationAdvisor.js')>;
}

const FIX = { bugClass: 'ConsoleError', severity: 'HIGH', message: 'TypeError: cannot read x of undefined', elementLabel: 'Submit' };
const INSIGHTS = {
  sessionId: 'selfcheck',
  riskLevel: 'high',
  findings: [
    { bugClass: 'XSS', severity: 'HIGH', message: 'reflected payload executed', elementLabel: 'search box' },
    { bugClass: 'NetworkError', severity: 'CRITICAL', message: 'API 500 on /api/orders' },
  ],
};

async function main() {
  assert.ok(REAL_KEY, 'GEMINI_API_KEY must be set to run this self-check');

  const happy = await withEnv('happy', { GEMINI_API_KEY: REAL_KEY, GEMINI_MODEL: REAL_MODEL || undefined, GEMINI_TIMEOUT_MS: '30000' });

  const fix = await happy.generateRemediation(FIX);
  assert.equal(fix.ok, true, `expected AI remediation, got ${JSON.stringify(fix)}`);
  assert.ok(fix.ok && fix.text.length > 20, 'remediation text too short');
  console.log('✓ remediation generated:', fix.ok ? `${fix.text.slice(0, 60)}…` : '');

  const insights = await happy.generateInsights(INSIGHTS);
  assert.equal(insights.ok, true, `expected AI insights, got ${JSON.stringify(insights)}`);
  assert.ok(insights.ok && insights.rootCause.length > 10 && insights.recommendations.length > 0, 'insights payload incomplete');
  console.log('✓ insights generated:', insights.ok ? `${insights.recommendations.length} recommendations` : '');

  const cases: Array<[string, Record<string, string | undefined>, string]> = [
    ['missing key', { GEMINI_API_KEY: undefined }, 'not_configured'],
    ['bad key', { GEMINI_API_KEY: 'not-a-real-key' }, 'auth'],
    ['bad model', { GEMINI_API_KEY: REAL_KEY, GEMINI_MODEL: 'no-such-model' }, 'model_unavailable'],
    ['timeout', { GEMINI_API_KEY: REAL_KEY, GEMINI_MODEL: REAL_MODEL || undefined, GEMINI_TIMEOUT_MS: '1' }, 'timeout'],
  ];
  for (const [name, env, expected] of cases) {
    const mod = await withEnv(name.replace(/\s/g, '-'), { GEMINI_TIMEOUT_MS: '30000', ...env });
    const result = await mod.generateRemediation(FIX);
    assert.equal(result.ok, false, `${name}: expected failure`);
    assert.equal(!result.ok && result.reason, expected, `${name}: wrong reason`);
    console.log(`✓ ${name} classified as ${expected}`);
  }

  console.log('\nAll Gemini self-checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
