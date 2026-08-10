import type { Request, Response, NextFunction } from 'express';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { issueTokenPair } from './refreshTokenService.js';
import { setRefreshCookie } from './refreshCookie.js';
import { validateEmail, requireNonEmptyString, isPasswordTooLong, maskEmail } from './authValidation.js';
import type { AuthErrorBody } from '../../../../shared/types.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[Auth]');

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

    // Validate + normalize inputs. Malformed email or an over-length password can
    // never match a real credential, so reject them up front — this also spares the
    // DB lookup and bcrypt compare (a password-length DoS guard). Neither check is
    // account-specific, so it never becomes an enumeration oracle.
    const trimmedEmail = validateEmail(email);
    const sanitizedPassword = requireNonEmptyString(password, 'password');

    if (!trimmedEmail || !sanitizedPassword) {
      const body: AuthErrorBody = {
        error: 'Email and password are required and must be valid strings',
        code: 'VALIDATION_FAILED',
        field: !trimmedEmail ? 'email' : 'password',
      };
      response.status(400).json(body);
      return;
    }

    if (isPasswordTooLong(sanitizedPassword)) {
      response.status(401).json(CREDENTIAL_REJECTION);
      return;
    }

    obsLog.info(`[Auth] Login attempt for: "${maskEmail(trimmedEmail)}"`);

    try {
      // Find user by email
      const user = await UserModel.findOne({ email: trimmedEmail });

      // EXPLICIT VALIDATION GUARD: Ensure user document exists before proceeding
      // This prevents any bypass where user could be null/undefined
      if (!user) {
        obsLog.info(`[AUTH FAILED]: No user document matched for input criteria.`);
        response.status(401).json(CREDENTIAL_REJECTION);
        return;
      }

      // Additional guard: Verify user object has required properties
      if (!user._id || !user.email || !user.password) {
        obsLog.error(`[AUTH FAILED]: User document missing required properties.`);
        response.status(401).json(CREDENTIAL_REJECTION);
        return;
      }

      // Verify password using model's comparePassword method (timing-safe via bcrypt)
      const isValidPassword = await user.comparePassword(sanitizedPassword);
      if (!isValidPassword) {
        obsLog.warn(`[Auth] Invalid password attempt for: ${maskEmail(trimmedEmail)}`);
        response.status(401).json(CREDENTIAL_REJECTION);
        return;
      }

      // Hard email-verification gate. Placed AFTER the password check so it only
      // reveals the unverified state to a caller who already holds the password —
      // it never becomes an enumeration oracle. Only an explicit `false` blocks;
      // accounts predating verification (field undefined) pass through.
      if (user.emailVerified === false) {
        obsLog.warn(`[Auth] Login blocked, email unverified: ${maskEmail(trimmedEmail)}`);
        const body: AuthErrorBody = {
          error: 'Please verify your email address before signing in',
          code: 'EMAIL_UNVERIFIED',
          field: 'email',
        };
        response.status(403).json(body);
        return;
      }

      // Short-lived access token plus a rotating refresh token in a new family.
      const tokens = await issueTokenPair(user._id.toString(), trimmedEmail);

      obsLog.info(`[Auth] User logged in: ${maskEmail(trimmedEmail)}`);

      // Refresh token leaves in an httpOnly cookie, never the JS-readable body.
      setRefreshCookie(response, tokens.refreshToken);
      response.json({
        ok: true,
        user: {
          id: user._id.toString(),
          email: trimmedEmail,
        },
        token: tokens.token,
        expiresIn: tokens.expiresIn,
      });
    } catch (dbError) {
      obsLog.error('[Auth] Database error during login:', dbError);
      throw dbError;
    }
  } catch (err) {
    obsLog.error('[Auth] Login error:', err);
    next(err);
  }
}
