import assert from 'node:assert';
import type { Request, Response, NextFunction } from 'express';
import { handleSignup } from './authSignupController.js';
import { generateCaptcha } from './captchaService.js';

// The captcha gate is the server-side mirror that stops a bot from bypassing the
// UI: these cases never reach the DB, so they run without a Mongo connection.

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function solve(prompt: string): number {
  const m = /What is (\w+) (plus|minus) (\w+)\?/.exec(prompt)!;
  const a = WORDS.indexOf(m[1]);
  const b = WORDS.indexOf(m[3]);
  return m[2] === 'minus' ? a - b : a + b;
}

interface Captured {
  status: number;
  body: { code?: string; field?: string };
  nextErr: unknown;
}

async function runSignup(body: Record<string, unknown>): Promise<Captured> {
  const captured: Captured = { status: 0, body: {}, nextErr: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload as Captured['body'];
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = (err?: unknown) => {
    captured.nextErr = err;
  };
  await handleSignup({ body } as Request, res, next);
  return captured;
}

const validPassword = 'Str0ng$pass';

// Missing captcha entirely — rejected before any account work.
const missing = await runSignup({ email: 'bot@example.com', password: validPassword });
assert.strictEqual(missing.status, 400, 'missing captcha is a 400');
assert.strictEqual(missing.body.code, 'CAPTCHA_FAILED', 'missing captcha -> CAPTCHA_FAILED');
assert.strictEqual(missing.body.field, 'captcha', 'error routes to the captcha field');

// A valid token with the WRONG answer is rejected (cannot bypass by crafting a request).
const wrongChallenge = generateCaptcha();
const wrong = await runSignup({
  email: 'bot2@example.com',
  password: validPassword,
  captchaToken: wrongChallenge.token,
  captchaAnswer: String(solve(wrongChallenge.prompt) + 1),
});
assert.strictEqual(wrong.body.code, 'CAPTCHA_FAILED', 'wrong answer -> CAPTCHA_FAILED');

// Basic input validation runs BEFORE the captcha, so a bad email never burns the
// single-use token: the same token must still verify afterwards.
const orderChallenge = generateCaptcha();
const badEmail = await runSignup({
  email: 'not-an-email',
  password: validPassword,
  captchaToken: orderChallenge.token,
  captchaAnswer: String(solve(orderChallenge.prompt)),
});
assert.strictEqual(badEmail.body.code, 'VALIDATION_FAILED', 'bad email fails validation first');
assert.strictEqual(badEmail.body.field, 'email', 'validation error routes to email, not captcha');

console.log('authSignupController captcha gate: all assertions passed');
