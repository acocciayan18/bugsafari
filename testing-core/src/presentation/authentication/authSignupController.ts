import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { validateEmail, requireNonEmptyString, validatePasswordComplexity, maskEmail } from './authValidation.js';
import { sendVerificationEmail, deliveredOrDevFallback, EMAIL_VERIFICATION_TTL_MS } from './emailTransport.js';
import type { AuthErrorBody } from '../../../../shared/types.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[Auth]');

const EMAIL_TAKEN: AuthErrorBody = {
  error: 'An account with this email already exists',
  code: 'EMAIL_TAKEN',
  field: 'email',
};

/**
 * POST /api/auth/signup
 * Register a new user with email and password
 */
export async function handleSignup(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = request.body;

    // Validate + normalize inputs before any DB or bcrypt work.
    const trimmedEmail = validateEmail(email);
    const sanitizedPassword = requireNonEmptyString(password, 'password');

    if (!trimmedEmail) {
      const body: AuthErrorBody = {
        error: 'Please enter a valid email address',
        code: 'VALIDATION_FAILED',
        field: 'email',
      };
      response.status(400).json(body);
      return;
    }
    if (!sanitizedPassword) {
      const body: AuthErrorBody = {
        error: 'Email and password are required and must be valid strings',
        code: 'VALIDATION_FAILED',
        field: 'password',
      };
      response.status(400).json(body);
      return;
    }

    const trimmedPassword = sanitizedPassword;

    // Defense-in-Depth: Run server-side mirror verification
    // Early-Abort Rejection: If bot bypasses frontend controls, halt execution
    const complexityError = validatePasswordComplexity(trimmedPassword);
    if (complexityError) {
      // The unmet rule is echoed verbatim — it is the caller's own input, so it
      // reveals nothing, and a vague "complexity guidelines" string left the
      // operator with no way to fix the password.
      const body: AuthErrorBody = { error: complexityError, code: 'PASSWORD_WEAK', field: 'password' };
      response.status(400).json(body);
      return;
    }

    try {
      // Check if user already exists
      const existingUser = await UserModel.findOne({ email: trimmedEmail });
      if (existingUser) {
        response.status(409).json(EMAIL_TAKEN);
        return;
      }

      // The plaintext verification token is sent only via email; the DB stores a
      // bcrypt hash, so a DB leak alone can't confirm an account.
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // Create user unverified and issue NO session — access is hard-gated behind
      // clicking the verification link (see handleVerifyEmail / login guard).
      const newUser = await UserModel.create({
        email: trimmedEmail,
        password: trimmedPassword,
        emailVerified: false,
        emailVerificationToken: await bcrypt.hash(verificationToken, 10),
        emailVerificationExpires: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      });

      // Awaited so signup reports success only after the verification email is
      // actually delivered (no false "check your inbox").
      const emailResult = await sendVerificationEmail(trimmedEmail, verificationToken);
      if (!deliveredOrDevFallback(emailResult)) {
        // Roll back the just-created account so the user can retry cleanly rather
        // than being blocked by EMAIL_TAKEN on an unverifiable orphan.
        await UserModel.deleteOne({ _id: newUser._id }).catch((e) =>
          obsLog.error('[Auth] Rollback after verification-email failure failed:', e),
        );
        obsLog.error(`[Auth] Verification email failed; rolled back signup for ${maskEmail(trimmedEmail)}`);
        const body: AuthErrorBody = {
          error: 'We could not send your verification email. Please try again in a moment.',
          code: 'EMAIL_SEND_FAILED',
          field: 'email',
        };
        response.status(502).json(body);
        return;
      }

      obsLog.info(`[Auth] New user registered (unverified): ${maskEmail(trimmedEmail)}`);
      response.status(201).json({
        ok: true,
        verificationRequired: true,
        email: trimmedEmail,
      });
    } catch (dbError) {
      // Duplicate key from the unique email index races the existence check above.
      if ((dbError as { code?: number }).code === 11000) {
        response.status(409).json(EMAIL_TAKEN);
        return;
      }
      next(dbError);
    }
  } catch (err) {
    next(err);
  }
}
