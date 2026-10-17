import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AUTH_CONFIG } from './authConfig.js';
import type { CaptchaChallenge } from '../../../../shared/types.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[Captcha]');

// Signup CAPTCHA: a stateless, signed, single-use arithmetic challenge. The token
// is an HS256 JWT bound to its own audience so it can never be replayed as an
// access token, and the expected answer is stored only as an HMAC inside it — the
// plaintext answer never reaches the client, so a crafted request cannot pass
// verification without solving the visible prompt. Single use is enforced by an
// in-process consumed-nonce cache (same pattern as the rate limiter: no external
// dep, bounded, swept) so one solved token cannot fuel many signups.

const CAPTCHA_AUDIENCE = 'bugsafari-captcha';
const CAPTCHA_ISSUER = AUTH_CONFIG.JWT_ISSUER;
// Short enough to bound replay, long enough that a human can read and answer.
const CAPTCHA_TTL_SECONDS = Number(process.env.BUGSAFARI_CAPTCHA_TTL_SECONDS ?? 300);
const SWEEP_INTERVAL_MS = 60_000;
// Cap consumed-nonce memory; oldest entries evict first under a token flood.
const MAX_CONSUMED = 50_000;

// Spelled-out operands harden the prompt against the most trivial scrapers while
// keeping it plain text a screen reader can announce verbatim.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

interface CaptchaClaims {
  // HMAC of the normalized expected answer, keyed by the JWT secret and nonce.
  h: string;
}

// jti -> consumed-at epoch ms. Marked on the first verify of a token.
const consumed = new Map<string, number>();

const sweep = setInterval(() => {
  const cutoff = Date.now() - CAPTCHA_TTL_SECONDS * 1000;
  for (const [jti, at] of consumed) {
    if (at <= cutoff) consumed.delete(jti);
  }
}, SWEEP_INTERVAL_MS);
sweep.unref?.();

// Normalize to a canonical answer string: trim, lowercase, map a spelled word
// back to its digit so "7" and "seven" both satisfy the same challenge.
function normalizeAnswer(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().toLowerCase();
  const asWord = NUMBER_WORDS.indexOf(cleaned);
  if (asWord >= 0) return String(asWord);
  const digits = cleaned.replace(/[^0-9]/g, '');
  return digits;
}

// Keyed HMAC so the expected answer is never recoverable from the token payload.
function hashAnswer(jti: string, normalized: string): string {
  return crypto.createHmac('sha256', AUTH_CONFIG.JWT_SECRET).update(`${jti}:${normalized}`).digest('hex');
}

// Build a random addition/subtraction prompt whose answer is a single 0-9 digit.
function buildArithmetic(): { prompt: string; answer: string } {
  const subtract = crypto.randomInt(0, 2) === 1;
  if (subtract) {
    const a = crypto.randomInt(1, 10);
    const b = crypto.randomInt(0, a + 1);
    return { prompt: `What is ${NUMBER_WORDS[a]} minus ${NUMBER_WORDS[b]}?`, answer: String(a - b) };
  }
  const a = crypto.randomInt(0, 10);
  const b = crypto.randomInt(0, 10 - a);
  return { prompt: `What is ${NUMBER_WORDS[a]} plus ${NUMBER_WORDS[b]}?`, answer: String(a + b) };
}

// Mint a fresh signed challenge. The nonce (jti) makes each token single-use.
export function generateCaptcha(): CaptchaChallenge {
  const { prompt, answer } = buildArithmetic();
  const jti = crypto.randomBytes(16).toString('hex');
  const claims: CaptchaClaims = { h: hashAnswer(jti, answer) };
  const token = jwt.sign(claims, AUTH_CONFIG.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: CAPTCHA_ISSUER,
    audience: CAPTCHA_AUDIENCE,
    jwtid: jti,
    expiresIn: CAPTCHA_TTL_SECONDS,
  });
  return { token, prompt, expiresInSeconds: CAPTCHA_TTL_SECONDS };
}

// Verify a submitted (token, answer). Each token yields exactly one attempt: the
// nonce is consumed up front so a wrong guess burns it and a bot cannot brute the
// tiny answer space against a single challenge.
export function verifyCaptcha(token: unknown, answer: unknown): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;

  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(token, AUTH_CONFIG.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: CAPTCHA_ISSUER,
      audience: CAPTCHA_AUDIENCE,
      clockTolerance: 5,
    }) as jwt.JwtPayload;
  } catch {
    return false;
  }

  const jti = claims.jti;
  const expected = typeof claims.h === 'string' ? claims.h : '';
  if (typeof jti !== 'string' || expected.length === 0) return false;

  // Single use: reject any token already seen, then record this attempt.
  if (consumed.has(jti)) return false;
  consumed.set(jti, Date.now());
  while (consumed.size > MAX_CONSUMED) {
    const oldest = consumed.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    consumed.delete(oldest);
  }

  const actual = hashAnswer(jti, normalizeAnswer(answer));
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(actual, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  const ok = crypto.timingSafeEqual(expectedBuf, actualBuf);
  if (!ok) obsLog.info('[Captcha] Challenge answer rejected');
  return ok;
}
