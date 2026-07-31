import type { Request, Response, NextFunction } from 'express';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { issueTokenPair } from './refreshTokenService.js';
import { requireNonEmptyString, validatePasswordComplexity, maskEmail } from './authValidation.js';
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

      // Create user - password will be hashed by pre-save hook in UserModel
      const newUser = await UserModel.create({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      const tokens = await issueTokenPair(newUser._id.toString(), trimmedEmail);

      console.log(`[Auth] New user registered: ${maskEmail(trimmedEmail)}`);

      response.status(201).json({
        ok: true,
        user: {
          id: newUser._id.toString(),
          email: trimmedEmail,
        },
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
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
