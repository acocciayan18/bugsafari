import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { requireNonEmptyString, validatePasswordComplexity, maskEmail } from './authValidation.js';
import { sendVerificationEmail, deliveredOrDevFallback, EMAIL_VERIFICATION_TTL_MS } from './emailTransport.js';
import type { AuthErrorBody } from '../../../../shared/types.js';

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

    // Validate and sanitize inputs
    const sanitizedEmail = requireNonEmptyString(email, 'email');
    const sanitizedPassword = requireNonEmptyString(password, 'password');

    if (!sanitizedEmail || !sanitizedPassword) {
      const body: AuthErrorBody = {
        error: 'Email and password are required and must be valid strings',
        code: 'VALIDATION_FAILED',
        field: !sanitizedEmail ? 'email' : 'password',
      };
      response.status(400).json(body);
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();
    const trimmedPassword = sanitizedPassword;

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
          console.error('[Auth] Rollback after verification-email failure failed:', e),
        );
        console.error(`[Auth] Verification email failed; rolled back signup for ${maskEmail(trimmedEmail)}`);
        const body: AuthErrorBody = {
          error: 'We could not send your verification email. Please try again in a moment.',
          code: 'EMAIL_SEND_FAILED',
          field: 'email',
        };
        response.status(502).json(body);
        return;
      }

      console.log(`[Auth] New user registered (unverified): ${maskEmail(trimmedEmail)}`);
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
