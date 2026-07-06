import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { AUTH_CONFIG } from './authConfig.js';
import { sanitizeString } from './authValidation.js';

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
    const sanitizedEmail = sanitizeString(email, 'email');
    const sanitizedPassword = sanitizeString(password, 'password');

    if (!sanitizedEmail || !sanitizedPassword) {
      response.status(400).json({
        error: 'Email and password are required and must be valid strings',
      });
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();

    console.log(`[Auth] Login attempt for: "${trimmedEmail}"`);
    console.log(`[Auth] Password length: ${sanitizedPassword?.length}`);

    try {
      // Find user by email
      const user = await UserModel.findOne({ email: trimmedEmail });
      console.log(`[Auth] User found:`, user ? `yes (id: ${user._id})` : 'no');

      // EXPLICIT VALIDATION GUARD: Ensure user document exists before proceeding
      // This prevents any bypass where user could be null/undefined
      if (!user) {
        console.log(`[AUTH FAILED]: No user document matched for input criteria.`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Additional guard: Verify user object has required properties
      if (!user._id || !user.email || !user.password) {
        console.error(`[AUTH FAILED]: User document missing required properties.`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Verify password using model's comparePassword method (timing-safe via bcrypt)
      const isValidPassword = await user.comparePassword(sanitizedPassword);
      if (!isValidPassword) {
        console.warn(`[Auth] Invalid password attempt for: ${trimmedEmail}`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user._id.toString(), email: trimmedEmail },
        AUTH_CONFIG.JWT_SECRET,
        { expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN } as jwt.SignOptions,
      );

      console.log(`[Auth] User logged in: ${trimmedEmail}`);

      response.json({
        ok: true,
        user: {
          id: user._id.toString(),
          email: trimmedEmail,
        },
        token,
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
