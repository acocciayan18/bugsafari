import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { requireNonEmptyString, validatePasswordComplexity, maskEmail } from './authValidation.js';
import { revokeAllForUser } from './refreshTokenService.js';
import { sendPasswordResetEmail, deliveredOrDevFallback, RESET_TOKEN_TTL_MS, formatDuration } from './emailTransport.js';
import type { AuthErrorBody } from '../../../../shared/types.js';

// Unknown email, wrong token and expired token are indistinguishable to the
// caller — any split would leak which reset links exist.
const RESET_TOKEN_REJECTION: AuthErrorBody = {
  error: 'Invalid or expired reset token',
  code: 'RESET_TOKEN_INVALID',
  field: 'token',
};

// Surfaced only when a reset email genuinely fails to send to a real account, so
// the frontend shows an honest error instead of a false "link sent".
const EMAIL_SEND_FAILED: AuthErrorBody = {
  error: 'We could not send the reset email right now. Please try again in a moment.',
  code: 'EMAIL_SEND_FAILED',
};

// A pre-computed bcrypt hash of a throwaway value. The user-miss branch compares
// against it so an unknown email costs the same bcrypt work as a real one,
// keeping response time from leaking account existence (anti-enumeration).
const TIMING_DECOY_HASH = bcrypt.hashSync('bugsafari-timing-decoy', 10);

/**
 * Generate a secure reset token
 */
function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * POST /api/auth/forgot-password
 * Request a password reset - generates token and emails a reset link
 */
export async function handleForgotPassword(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = request.body;

    // Validate and sanitize email
    const sanitizedEmail = requireNonEmptyString(email, 'email');

    if (!sanitizedEmail) {
      const body: AuthErrorBody = { error: 'Email is required', code: 'VALIDATION_FAILED', field: 'email' };
      response.status(400).json(body);
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();

    // Additional validation
    if (trimmedEmail.length < 5 || !trimmedEmail.includes('@')) {
      const body: AuthErrorBody = {
        error: 'Please enter a valid email address',
        code: 'VALIDATION_FAILED',
        field: 'email',
      };
      response.status(400).json(body);
      return;
    }

    // Find user by email
    const user = await UserModel.findOne({ email: trimmedEmail });

    // Anti-enumeration: an unknown address gets the SAME generic success and an
    // equivalent bcrypt cost, so it cannot be told apart from a known one.
    if (!user) {
      await bcrypt.compare(generateResetToken(), TIMING_DECOY_HASH);
      console.log(`[FORGOT PASSWORD] No user found for email: ${maskEmail(trimmedEmail)}`);
      response.json({ ok: true, message: 'If an account exists with that email, a password reset link has been sent.' });
      return;
    }

    // The plaintext token is only ever sent to the user (email/link) - the DB
    // stores a bcrypt hash of it, so a DB leak alone can't be replayed.
    const resetToken = generateResetToken();
    user.resetPasswordToken = await bcrypt.hash(resetToken, 10);
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    console.log(`[FORGOT PASSWORD] Reset requested for: ${maskEmail(trimmedEmail)} (expires in ${formatDuration(RESET_TOKEN_TTL_MS)})`);

    // Awaited so success is reported only after delivery is confirmed. A real send
    // failure surfaces an honest error rather than a false "link sent". (Trade-off:
    // for a known account this is distinguishable from the unknown-account success
    // during an SMTP outage — an accepted risk to keep delivery feedback truthful.)
    const sent = await sendPasswordResetEmail(trimmedEmail, resetToken);
    if (!deliveredOrDevFallback(sent)) {
      response.status(502).json(EMAIL_SEND_FAILED);
      return;
    }

    response.json({ ok: true, message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 * Reset password using the token from forgot-password
 */
export async function handleResetPassword(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, token, newPassword } = request.body;

    // Validate inputs
    const sanitizedEmail = requireNonEmptyString(email, 'email');
    const sanitizedToken = requireNonEmptyString(token, 'token');
    const sanitizedPassword = requireNonEmptyString(newPassword, 'newPassword');

    if (!sanitizedEmail || !sanitizedToken || !sanitizedPassword) {
      // A missing email/token means a mangled link, not a form mistake — route it
      // to the link-expired copy instead of blaming the password field.
      if (!sanitizedEmail || !sanitizedToken) {
        response.status(400).json(RESET_TOKEN_REJECTION);
        return;
      }
      const body: AuthErrorBody = {
        error: 'A new password is required',
        code: 'VALIDATION_FAILED',
        field: 'password',
      };
      response.status(400).json(body);
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();
    const trimmedToken = sanitizedToken.trim();
    const trimmedPassword = sanitizedPassword;

    // Validate password complexity
    const complexityError = validatePasswordComplexity(trimmedPassword);
    if (complexityError) {
      const body: AuthErrorBody = { error: complexityError, code: 'PASSWORD_WEAK', field: 'password' };
      response.status(400).json(body);
      return;
    }

    // Find user by email
    const user = await UserModel.findOne({ email: trimmedEmail });

    if (!user) {
      // Match the bcrypt cost of the found-user path so an unknown email is not
      // measurably faster to reject than a wrong token on a real account.
      await bcrypt.compare(trimmedToken, TIMING_DECOY_HASH);
      response.status(400).json(RESET_TOKEN_REJECTION);
      return;
    }

    // Verify token matches (hash compare, not raw !==) and hasn't expired
    const tokenMatches = user.resetPasswordToken
      ? await bcrypt.compare(trimmedToken, user.resetPasswordToken)
      : false;
    if (
      !tokenMatches ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires < new Date()
    ) {
      console.warn(`[RESET PASSWORD] Invalid or expired token for: ${maskEmail(trimmedEmail)}`);
      response.status(400).json(RESET_TOKEN_REJECTION);
      return;
    }

    // Update password (will be hashed by pre-save hook)
    user.password = trimmedPassword;

    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    // A password change must terminate every session established with the old
    // one. Outstanding access tokens remain valid until their short TTL lapses.
    const revoked = await revokeAllForUser(user._id.toString(), 'password-reset');

    console.log(`[RESET PASSWORD] Password successfully reset for: ${maskEmail(trimmedEmail)} (${revoked} session(s) revoked)`);

    response.json({
      ok: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
}
