import type { Request, Response, NextFunction } from 'express';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { issueTokenPair } from './refreshTokenService.js';
import { requireNonEmptyString, maskEmail } from './authValidation.js';
import type { AuthErrorBody } from '../../../../shared/types.js';

// Wrong-email and wrong-password answer identically — telling them apart would
// turn the login route into an account enumeration oracle.
const CREDENTIAL_REJECTION: AuthErrorBody = {
  error: 'Invalid email or password',
  code: 'INVALID_CREDENTIALS',
};

/**
 * POST /api/auth/login
 * Authenticate an existing user and return JWT token
 * Uses timing-safe password comparison to prevent timing attacks
 */
export async function handleLogin(
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

    console.log(`[Auth] Login attempt for: "${maskEmail(trimmedEmail)}"`);

    try {
      // Find user by email
      const user = await UserModel.findOne({ email: trimmedEmail });

      // EXPLICIT VALIDATION GUARD: Ensure user document exists before proceeding
      // This prevents any bypass where user could be null/undefined
      if (!user) {
        console.log(`[AUTH FAILED]: No user document matched for input criteria.`);
        response.status(401).json(CREDENTIAL_REJECTION);
        return;
      }

      // Additional guard: Verify user object has required properties
      if (!user._id || !user.email || !user.password) {
        console.error(`[AUTH FAILED]: User document missing required properties.`);
        response.status(401).json(CREDENTIAL_REJECTION);
        return;
      }

      // Verify password using model's comparePassword method (timing-safe via bcrypt)
      const isValidPassword = await user.comparePassword(sanitizedPassword);
      if (!isValidPassword) {
        console.warn(`[Auth] Invalid password attempt for: ${maskEmail(trimmedEmail)}`);
        response.status(401).json(CREDENTIAL_REJECTION);
        return;
      }

      // Short-lived access token plus a rotating refresh token in a new family.
      const tokens = await issueTokenPair(user._id.toString(), trimmedEmail);

      console.log(`[Auth] User logged in: ${maskEmail(trimmedEmail)}`);

      response.json({
        ok: true,
        user: {
          id: user._id.toString(),
          email: trimmedEmail,
        },
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });
    } catch (dbError) {
      console.error('[Auth] Database error during login:', dbError);
      throw dbError;
    }
  } catch (err) {
    console.error('[Auth] Login error:', err);
    next(err);
  }
}
