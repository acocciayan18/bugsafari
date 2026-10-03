import assert from 'node:assert/strict';
import type { Response } from 'express';
import {
  createSupportHandler,
  sanitizeDiagnostics,
  type SupportHandlerDeps,
  type SupportTicketInput,
} from './supportController.js';
import type { AuthRequest } from '../authentication/authMiddleware.js';
import type { SupportTicketEmail } from '../authentication/emailTransport.js';

// Self-executing script (no runner). Covers the diagnostics sanitizer (whitelist +
// bounds, the SSRF/PII guard) and the support handler's validation, token-email
// precedence, DB-fail path and best-effort email contract.

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

interface Captured {
  status: number | null;
  body: { ok?: boolean; ticketId?: string; emailed?: boolean; error?: string } | null;
}

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: null, body: null };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload as Captured['body']; return this; },
  } as unknown as Response;
  return { res, captured };
}

function makeDeps(overrides: Partial<SupportHandlerDeps> = {}) {
  const calls = { create: [] as SupportTicketInput[], email: [] as SupportTicketEmail[] };
  const deps: SupportHandlerDeps = {
    createTicket: async (input) => { calls.create.push(input); return { id: 'tkt_1' }; },
    sendTicketEmail: async (payload) => { calls.email.push(payload); return { ok: true }; },
    ...overrides,
  };
  return { deps, calls };
}

async function run(body: unknown, auth: { userId?: string; userEmail?: string }, deps: SupportHandlerDeps): Promise<Captured> {
  const req = { body, userId: auth.userId, userEmail: auth.userEmail } as unknown as AuthRequest;
  const { res, captured } = makeRes();
  await createSupportHandler(deps)(req, res, () => undefined);
  return captured;
}

const validBody = { mode: 'ticket', category: 'bug', subject: 'Crash on save', description: 'It explodes.' };

async function main(): Promise<void> {
  console.log('sanitizeDiagnostics');

  await check('non-object input → null', () => {
    assert.equal(sanitizeDiagnostics(undefined), null);
    assert.equal(sanitizeDiagnostics(null), null);
    assert.equal(sanitizeDiagnostics('x'), null);
    assert.equal(sanitizeDiagnostics(42), null);
  });

  await check('unknown keys are dropped', () => {
    const out = sanitizeDiagnostics({ appVersion: '1.0.0', token: 'secret', cookie: 'abc' });
    assert.deepEqual(out, { appVersion: '1.0.0' });
  });

  await check('known keys kept and trimmed', () => {
    const out = sanitizeDiagnostics({ appVersion: '  1.0.0  ', route: '/dashboard' });
    assert.deepEqual(out, { appVersion: '1.0.0', route: '/dashboard' });
  });

  await check('oversized value is truncated to 400 chars', () => {
    const out = sanitizeDiagnostics({ userAgent: 'u'.repeat(1000) });
    assert.equal(out?.userAgent.length, 400);
  });

  await check('non-string and empty values are dropped', () => {
    assert.equal(sanitizeDiagnostics({ appVersion: 123, route: '   ' }), null);
  });

  console.log('createSupportHandler');

  await check('signed-in valid → 201, token email wins over body, emailed true', async () => {
    const { deps, calls } = makeDeps();
    const captured = await run({ ...validBody, email: 'attacker@evil.co' }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(captured.status, 201);
    assert.deepEqual(captured.body, { ok: true, ticketId: 'tkt_1', emailed: true });
    assert.equal(calls.create[0].email, 'me@acct.co', 'body email must never override the token identity');
    assert.equal(calls.create[0].userId, 'u1');
    assert.equal(calls.email[0].accountLabel, 'Signed-in operator');
  });

  await check('guest valid with body email → 201, userId null, Guest label', async () => {
    const { deps, calls } = makeDeps();
    const captured = await run({ ...validBody, email: 'guest@user.co' }, {}, deps);
    assert.equal(captured.status, 201);
    assert.equal(calls.create[0].email, 'guest@user.co');
    assert.equal(calls.create[0].userId, null);
    assert.equal(calls.email[0].accountLabel, 'Guest');
  });

  await check('missing subject → 400, nothing persisted', async () => {
    const { deps, calls } = makeDeps();
    const captured = await run({ ...validBody, subject: '  ' }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(captured.status, 400);
    assert.equal(calls.create.length, 0);
    assert.equal(calls.email.length, 0);
  });

  await check('invalid mode → 400', async () => {
    const { deps } = makeDeps();
    const captured = await run({ ...validBody, mode: 'nope' }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(captured.status, 400);
  });

  await check('guest with invalid email → 400', async () => {
    const { deps } = makeDeps();
    const captured = await run({ ...validBody, email: 'not-an-email' }, {}, deps);
    assert.equal(captured.status, 400);
  });

  await check('guest with no email → 400', async () => {
    const { deps } = makeDeps();
    const captured = await run({ ...validBody }, {}, deps);
    assert.equal(captured.status, 400);
  });

  await check('unknown category defaults to "other"', async () => {
    const { deps, calls } = makeDeps();
    await run({ ...validBody, category: 'bogus' }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(calls.create[0].category, 'other');
  });

  await check('diagnostics are sanitized before persist and email', async () => {
    const { deps, calls } = makeDeps();
    await run(
      { ...validBody, diagnostics: { appVersion: '1.0.0', secret: 'leak' } },
      { userId: 'u1', userEmail: 'me@acct.co' },
      deps,
    );
    assert.deepEqual(calls.create[0].diagnostics, { appVersion: '1.0.0' });
    assert.deepEqual(calls.email[0].diagnostics, { appVersion: '1.0.0' });
  });

  await check('absent details/diagnostics persist as null', async () => {
    const { deps, calls } = makeDeps();
    await run({ ...validBody }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(calls.create[0].details, null);
    assert.equal(calls.create[0].diagnostics, null);
  });

  await check('persistence failure → 500, email never attempted', async () => {
    const { deps, calls } = makeDeps({ createTicket: async () => { throw new Error('db down'); } });
    const captured = await run({ ...validBody }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(captured.status, 500);
    assert.equal(captured.body?.ok, undefined);
    assert.equal(calls.email.length, 0);
  });

  await check('email returning ok:false → still 201, emailed false (ticket durable)', async () => {
    const { deps } = makeDeps({ sendTicketEmail: async () => ({ ok: false }) });
    const captured = await run({ ...validBody }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(captured.status, 201);
    assert.deepEqual(captured.body, { ok: true, ticketId: 'tkt_1', emailed: false });
  });

  await check('email throwing → still 201, emailed false', async () => {
    const { deps } = makeDeps({ sendTicketEmail: async () => { throw new Error('smtp blew up'); } });
    const captured = await run({ ...validBody }, { userId: 'u1', userEmail: 'me@acct.co' }, deps);
    assert.equal(captured.status, 201);
    assert.equal(captured.body?.emailed, false);
  });

  console.log(`\n${passed} assertion group(s) passed.`);
}

void main();
