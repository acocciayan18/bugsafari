import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { validateEmail, validateToken, maskEmail } from './authValidation.js';
import { issueTokenPair } from './refreshTokenService.js';
import { sendVerificationEmail, deliveredOrDevFallback, EMAIL_VERIFICATION_TTL_MS } from './emailTransport.js';
import type { AuthErrorBody } from '../../../../shared/types.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[VERIFY EMAIL]');

// Unknown email, wrong token and expired token are indistinguishable — any split
// would leak which pending verifications exist.
const VERIFICATION_REJECTION: AuthErrorBody = {
  error: 'Invalid or expired verification link',
  code: 'VERIFICATION_TOKEN_INVALID',
  field: 'token',
};

// Decoy hash so a user-miss costs the same bcrypt work as a real compare.
const TIMING_DECOY_HASH = bcrypt.hashSync('bugsafari-verify-decoy', 10);

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * POST /api/auth/verify-email
 * Confirm an account's email and auto-login on success.
 */
export async function handleVerifyEmail(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, token } = request.body;

    // A malformed email/token is indistinguishable from an unknown/expired one.
    const trimmedEmail = validateEmail(email);
    const trimmedToken = validateToken(token);
    if (!trimmedEmail || !trimmedToken) {
      response.status(400).json(VERIFICATION_REJECTION);
      return;
    }

    const user = await UserModel.findOne({ email: trimmedEmail });
    if (!user) {
      await bcrypt.compare(trimmedToken, TIMING_DECOY_HASH);
      response.status(400).json(VERIFICATION_REJECTION);
      return;
    }

    // Idempotent: a link opened after the account is already verified is not an
    // error — send the operator to login rather than a scary rejection.
    if (user.emailVerified === true) {
      response.json({ ok: true, alreadyVerified: true, email: trimmedEmail });
      return;
    }

    const tokenMatches = user.emailVerificationToken
      ? await bcrypt.compare(trimmedToken, user.emailVerificationToken)
      : false;
    if (
      !tokenMatches ||
      !user.emailVerificationExpires ||
      user.emailVerificationExpires < new Date()
    ) {
      obsLog.warn(`[VERIFY EMAIL] Invalid or expired token for: ${maskEmail(trimmedEmail)}`);
      response.status(400).json(VERIFICATION_REJECTION);
      return;
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Auto-login: the click proves control of the inbox, so hand back a session
    // in the same shape login returns.
    const tokens = await issueTokenPair(user._id.toString(), trimmedEmail);
    obsLog.info(`[VERIFY EMAIL] Account verified: ${maskEmail(trimmedEmail)}`);

    response.json({
      ok: true,
      user: { id: user._id.toString(), email: trimmedEmail },
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/resend-verification
 * Re-issue a verification link. Generic success regardless of account state to
 * avoid enumeration.
 */
export async function handleResendVerification(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = request.body;

    const trimmedEmail = validateEmail(email);
    if (!trimmedEmail) {
      const body: AuthErrorBody = { error: 'Please enter a valid email address', code: 'VALIDATION_FAILED', field: 'email' };
      response.status(400).json(body);
      return;
    }

    const user = await UserModel.findOne({ email: trimmedEmail });

    if (user && user.emailVerified === false) {
      const verificationToken = generateToken();
      user.emailVerificationToken = await bcrypt.hash(verificationToken, 10);
      user.emailVerificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
      await user.save();
      obsLog.info(`[RESEND VERIFICATION] Re-sent for: ${maskEmail(trimmedEmail)}`);
      // Awaited so a real send failure is reported honestly instead of a false success.
      const emailResult = await sendVerificationEmail(trimmedEmail, verificationToken);
      if (!deliveredOrDevFallback(emailResult)) {
        const body: AuthErrorBody = {
          error: 'We could not send the verification email right now. Please try again in a moment.',
          code: 'EMAIL_SEND_FAILED',
        };
        response.status(502).json(body);
        return;
      }
    } else {
      // No account, or already verified: burn an equivalent bcrypt cycle so this
      // branch is not measurably faster.
      await bcrypt.compare(generateToken(), TIMING_DECOY_HASH);
      obsLog.info(`[RESEND VERIFICATION] No pending verification for: ${maskEmail(trimmedEmail)}`);
    }

    response.json({
      ok: true,
      message: 'If an unverified account exists with that email, a new verification link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}
