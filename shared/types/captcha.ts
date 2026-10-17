// ═══════════════════════════════════════════════════════════════
// shared/types/captcha.ts — OPERATOR SIGNUP CAPTCHA CONTRACT
// ═══════════════════════════════════════════════════════════════
// The challenge BugSafari issues before a new operator account can be created.
// The server mints a signed, single-use, time-boxed token; the dashboard shows
// `prompt` to the human and returns (token, answer) on signup. The expected
// answer never leaves the server in readable form, so a frontend request cannot
// be forged to pass verification.

/** A freshly minted challenge handed to the signup form. */
export interface CaptchaChallenge {
  // Opaque signed token carrying the hashed answer, nonce and expiry.
  token: string;
  // Human-readable question, e.g. "What is seven plus three?".
  prompt: string;
  // Seconds until the token expires and the form must request a new one.
  expiresInSeconds: number;
}
